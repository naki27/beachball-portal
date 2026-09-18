import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associations, mailLogs, platformAdmins, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { createTeam, findTeam, listTeams, softDeleteTeam } from "@/lib/repo/teams";

// RLS とロールの権限のテスト（設計書 §5.14「漏れを機構で防ぐ」3・§12.1「テナント分離」）
// 準備と後片付けは app_owner、検査は app_user（DATABASE_URL）で行う。作った行は自分で消す
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const INSUFFICIENT_PRIVILEGE = "42501"; // RLS の with check と、権限のない表の両方

function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  return run().then(
    () => "ok",
    (error: unknown) => pgErrorCode(error) ?? String(error),
  );
}

const random = () => Math.random().toString(36).slice(2, 10);

let otherId = "";
let userId = "";
let sawaraTeamId = "";
let otherTeamId = "";
const sawaraTeamIds: string[] = [];

beforeAll(async () => {
  const [other] = await owner
    .insert(associations)
    .values({ name: "RLS テスト協会", slug: `rls-${random()}` })
    .returning({ id: associations.id });
  otherId = other.id;
  const [user] = await owner.insert(users).values({ email: `rls-${random()}@example.com` }).returning({ id: users.id });
  userId = user.id;
  sawaraTeamId = (
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
      createTeam(tx, SAWARA_ASSOCIATION_ID, { name: "RLS テスト（早良）", createdBy: userId }),
    )
  ).id;
  sawaraTeamIds.push(sawaraTeamId);
  otherTeamId = (await withTenantOn(owner, otherId, (tx) => createTeam(tx, otherId, { name: "RLS テスト（別）" }))).id;
});

afterAll(async () => {
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.delete(teams).where(inArray(teams.id, sawaraTeamIds));
  });
  await withTenantOn(owner, otherId, async (tx) => {
    await tx.delete(teams).where(eq(teams.associationId, otherId));
  });
  await owner.delete(associations).where(eq(associations.id, otherId));
  await owner.delete(users).where(eq(users.id, userId));
  await closeDb(owner);
  await closeDb(app);
});

describe("RLS（app_user）", () => {
  it("SET LOCAL をしないクエリは 0 件", async () => {
    const rows = await app.select({ id: teams.id }).from(teams);
    expect(rows).toEqual([]);
  });

  it("別の協会を SET LOCAL すると自協会の行が見えない（ID を直に指定しても）", async () => {
    const visible = await withTenantOn(app, otherId, (tx) => listTeams(tx, otherId));
    expect(visible.map((t) => t.id)).toEqual([otherTeamId]);

    const direct = await withTenantOn(app, otherId, (tx) =>
      tx.select({ id: teams.id }).from(teams).where(eq(teams.id, sawaraTeamId)),
    );
    expect(direct).toEqual([]);
  });

  it("別の協会の行は書けない（with check）", async () => {
    expect(
      await outcome(() =>
        withTenantOn(app, SAWARA_ASSOCIATION_ID, (tx) =>
          tx.insert(teams).values({ associationId: otherId, name: "よその協会に書く" }),
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);

    expect(
      await outcome(() =>
        withTenantOn(app, SAWARA_ASSOCIATION_ID, (tx) =>
          tx.update(teams).set({ associationId: otherId }).where(eq(teams.id, sawaraTeamId)),
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("所有者（app_owner）にも効く（FORCE）", async () => {
    const rows = await owner.select({ id: teams.id }).from(teams);
    expect(rows).toEqual([]);
  });
});

describe("ロールの権限（app_user）", () => {
  it("platform_admins は読めるが書けない", async () => {
    expect(await outcome(() => app.select().from(platformAdmins))).toBe("ok");
    expect(await outcome(() => app.insert(platformAdmins).values({ userId }))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("mail_logs は書けるが読めない（読むのは管理画面用の関数経由）", async () => {
    expect(await outcome(() => app.select({ id: mailLogs.id }).from(mailLogs))).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe("リポジトリ（削除済みの除外が既定）", () => {
  it("論理削除したチームは既定で出ず、includeDeleted のときだけ出る", async () => {
    const team = await withTenantOn(app, SAWARA_ASSOCIATION_ID, (tx) =>
      createTeam(tx, SAWARA_ASSOCIATION_ID, { name: "削除されるチーム", createdBy: userId }),
    );
    sawaraTeamIds.push(team.id);

    const deleted = await withTenantOn(app, SAWARA_ASSOCIATION_ID, (tx) =>
      softDeleteTeam(tx, SAWARA_ASSOCIATION_ID, team.id, userId),
    );
    expect(deleted).toBe(true);

    const [hidden, shown] = await withTenantOn(app, SAWARA_ASSOCIATION_ID, async (tx) => [
      await findTeam(tx, SAWARA_ASSOCIATION_ID, team.id),
      await findTeam(tx, SAWARA_ASSOCIATION_ID, team.id, { includeDeleted: true }),
    ]);
    expect(hidden).toBeNull();
    expect(shown?.id).toBe(team.id);

    // 2 回目の削除は「すでに削除済み」なので false
    expect(
      await withTenantOn(app, SAWARA_ASSOCIATION_ID, (tx) => softDeleteTeam(tx, SAWARA_ASSOCIATION_ID, team.id, userId)),
    ).toBe(false);
    // ほかの協会の ID で呼ぶと、同じ ID でも見えない（associationId をクエリに入れている）
    expect(
      await withTenantOn(app, otherId, (tx) => findTeam(tx, otherId, team.id, { includeDeleted: true })),
    ).toBeNull();
  });
});
