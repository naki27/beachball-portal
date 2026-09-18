import { TransactionRollbackError, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associations, members, teamMembers, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import type { Tx } from "@/db/tenant";

// DB の制約のテスト（設計書 §12.1「DB の制約」）。app_owner で接続し、1 つのトランザクションの中で行って最後に戻す
// 失敗させる INSERT は savepoint（入れ子の transaction）の中で行い、外のトランザクションを壊さない
const db = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
afterAll(() => closeDb(db));

const FK_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

// 実行して、Postgres のエラーコードを返す（成功したら "ok"）
async function outcome(run: () => Promise<unknown>): Promise<string> {
  return run().then(
    () => "ok",
    (error: unknown) => pgErrorCode(error) ?? String(error),
  );
}

async function withRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

const NOW = new Date();

async function createAssociation(tx: Tx, name: string): Promise<string> {
  const slug = `t-${Math.random().toString(36).slice(2, 10)}`;
  const [row] = await tx.insert(associations).values({ name, slug }).returning({ id: associations.id });
  return row.id;
}

async function createMember(tx: Tx, associationId: string, name: string): Promise<string> {
  const [row] = await tx
    .insert(members)
    .values({ associationId, name, birthDate: "1990-04-01", sex: "male", nameNormalized: name })
    .returning({ id: members.id });
  return row.id;
}

async function createTeam(tx: Tx, associationId: string, name: string): Promise<string> {
  const [row] = await tx.insert(teams).values({ associationId, name }).returning({ id: teams.id });
  return row.id;
}

describe("複合外部キー（別の協会の親を指せない・§7.0）", () => {
  it("team_members: 別の協会のチーム・人物を指す INSERT は DB で失敗する", () =>
    withRollback(async (tx) => {
      const other = await createAssociation(tx, "別の協会");
      const teamA = await createTeam(tx, SAWARA_ASSOCIATION_ID, "チームA");
      const memberA = await createMember(tx, SAWARA_ASSOCIATION_ID, "早良太郎");
      const memberB = await createMember(tx, other, "別区花子");

      // 協会 A の名簿に、協会 B の人物
      expect(
        await outcome(() =>
          tx.transaction((sp) =>
            sp.insert(teamMembers).values({ associationId: SAWARA_ASSOCIATION_ID, teamId: teamA, memberId: memberB }),
          ),
        ),
      ).toBe(FK_VIOLATION);
      // 協会 B の名簿に、協会 A のチーム
      expect(
        await outcome(() =>
          tx.transaction((sp) => sp.insert(teamMembers).values({ associationId: other, teamId: teamA, memberId: memberB })),
        ),
      ).toBe(FK_VIOLATION);
      // 協会の欄だけ嘘（A のチームと A の人物を B の行として入れる）
      expect(
        await outcome(() =>
          tx.transaction((sp) => sp.insert(teamMembers).values({ associationId: other, teamId: teamA, memberId: memberA })),
        ),
      ).toBe(FK_VIOLATION);
      // 正しい組み合わせは通る
      expect(
        await outcome(() =>
          tx.insert(teamMembers).values({ associationId: SAWARA_ASSOCIATION_ID, teamId: teamA, memberId: memberA }),
        ),
      ).toBe("ok");
    }));
});

describe("部分一意インデックス（削除済みと同じ内容で登録し直せる・§5.16）", () => {
  it("team_members: 同じ人物の 2 行目は失敗し、脱退または削除のあとは登録し直せる", () =>
    withRollback(async (tx) => {
      const team = await createTeam(tx, SAWARA_ASSOCIATION_ID, "チームA");
      const member = await createMember(tx, SAWARA_ASSOCIATION_ID, "早良太郎");
      const row = { associationId: SAWARA_ASSOCIATION_ID, teamId: team, memberId: member };

      const [first] = await tx.insert(teamMembers).values(row).returning({ id: teamMembers.id });
      expect(await outcome(() => tx.transaction((sp) => sp.insert(teamMembers).values(row)))).toBe(UNIQUE_VIOLATION);

      // 脱退（left_at）: 過去の所属は残したまま、もう一度入れられる
      await tx.update(teamMembers).set({ leftAt: NOW }).where(eq(teamMembers.id, first.id));
      const [second] = await tx.insert(teamMembers).values(row).returning({ id: teamMembers.id });

      // 論理削除（deleted_at）: 同じ
      await tx.update(teamMembers).set({ deletedAt: NOW }).where(eq(teamMembers.id, second.id));
      expect(await outcome(() => tx.insert(teamMembers).values(row))).toBe("ok");

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team));
      expect(count).toBe(3);
    }));

  it("teams: 個人登録は 1 人 1 つ。削除したら作り直せる", () =>
    withRollback(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: `t-${Math.random().toString(36).slice(2, 10)}@example.com` })
        .returning({ id: users.id });
      const individual = { associationId: SAWARA_ASSOCIATION_ID, kind: "individual" as const, name: "早良太郎", createdBy: user.id };

      const [first] = await tx.insert(teams).values(individual).returning({ id: teams.id });
      expect(await outcome(() => tx.transaction((sp) => sp.insert(teams).values(individual)))).toBe(UNIQUE_VIOLATION);
      // 普通のチームは何個でも作れる
      expect(await outcome(() => tx.insert(teams).values({ ...individual, kind: "team" }))).toBe("ok");

      await tx.update(teams).set({ deletedAt: NOW }).where(eq(teams.id, first.id));
      expect(await outcome(() => tx.insert(teams).values(individual))).toBe("ok");
    }));

  it("members: 協会内で 1 アカウント = 1 人物。削除したら紐づけ直せる", () =>
    withRollback(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: `t-${Math.random().toString(36).slice(2, 10)}@example.com` })
        .returning({ id: users.id });
      const other = await createAssociation(tx, "別の協会");
      const person = { name: "早良太郎", birthDate: "1990-04-01", sex: "male" as const, nameNormalized: "早良太郎", userId: user.id };

      const [first] = await tx
        .insert(members)
        .values({ associationId: SAWARA_ASSOCIATION_ID, ...person })
        .returning({ id: members.id });
      expect(
        await outcome(() =>
          tx.transaction((sp) => sp.insert(members).values({ associationId: SAWARA_ASSOCIATION_ID, ...person })),
        ),
      ).toBe(UNIQUE_VIOLATION);
      // 別の協会では同じアカウントに別の人物を紐づけられる
      expect(await outcome(() => tx.insert(members).values({ associationId: other, ...person }))).toBe("ok");

      await tx.update(members).set({ deletedAt: NOW }).where(eq(members.id, first.id));
      expect(await outcome(() => tx.insert(members).values({ associationId: SAWARA_ASSOCIATION_ID, ...person }))).toBe("ok");
    }));
});
