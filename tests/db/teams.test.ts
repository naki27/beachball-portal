import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, teamAdmins, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { listTeamsAdminedBy } from "@/lib/repo/teams";
import { editTeam, registerTeam, TeamError } from "@/lib/teams/teams";

// チームの作成と代表者・チーム情報の編集（設計書 §5.11「チームの作り方」・§3.1 の判定の順）
// 操作は app_user、準備と後片付けは app_owner
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 10);
const S = SAWARA_ASSOCIATION_ID;

let otherId = "";
let otherTeamId = "";
const userIds: Record<"founder" | "stranger" | "admin", string> = { founder: "", stranger: "", admin: "" };
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

async function statusOf(run: () => Promise<unknown>): Promise<number | "ok"> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

beforeAll(async () => {
  for (const key of Object.keys(userIds) as (keyof typeof userIds)[]) {
    const [u] = await owner
      .insert(users)
      .values({ email: `teams-${key}-${random()}@example.com` })
      .returning({ id: users.id });
    userIds[key] = u.id;
  }
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: userIds.admin }));
  const [other] = await owner
    .insert(associations)
    .values({ name: "チームのテスト協会", slug: `teams-${random()}` })
    .returning({ id: associations.id });
  otherId = other.id;
  const [otherTeam] = await withTenantOn(owner, otherId, (tx) =>
    tx.insert(teams).values({ associationId: otherId, name: "よその協会のチーム" }).returning({ id: teams.id }),
  );
  otherTeamId = otherTeam.id;
});

afterAll(async () => {
  const ids = Object.values(userIds);
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(teamAdmins).where(inArray(teamAdmins.userId, ids));
    await tx.delete(teams).where(inArray(teams.createdBy, ids));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, userIds.admin));
  });
  await withTenantOn(owner, otherId, (tx) => tx.delete(teams).where(eq(teams.associationId, otherId)));
  await owner.delete(associations).where(eq(associations.id, otherId));
  await owner.delete(users).where(inArray(users.id, ids));
  await closeDb(owner);
  await closeDb(app);
});

const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false };

describe("registerTeam（チームで登録）", () => {
  it("チーム名だけで作れ、作った人が代表者（granted_by NULL）になる。協会員の登録をするチームは外れている", async () => {
    const name = `登録テスト ${random()}`;
    const team = await registerTeam(app, S, userIds.founder, { ...base, name });
    expect(team).toMatchObject({ associationId: S, name, kind: "team", createdBy: userIds.founder, membershipRenewalTarget: false });
    const admins = await withTenantOn(owner, S, (tx) => tx.select().from(teamAdmins).where(eq(teamAdmins.teamId, team.id)));
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({ userId: userIds.founder, grantedBy: null, revokedAt: null });
    const mine = await withTenantOn(app, S, (tx) => listTeamsAdminedBy(tx, S, userIds.founder));
    expect(mine.map((t) => t.id)).toContain(team.id);
  });

  it("同じ名前（表記の揺れを含む）のチームがあれば 409 で知らせ、確かめたうえでなら作れる", async () => {
    const key = random();
    const first = await registerTeam(app, S, userIds.founder, { ...base, name: `ABC クラブ ${key}` });

    // 自分が代表者でないチームは数だけ
    const other = (await registerTeam(app, S, userIds.stranger, { ...base, name: `ａｂｃくらぶ　${key}` }).catch(
      (e: unknown) => e,
    )) as TeamError;
    expect(other).toBeInstanceOf(TeamError);
    expect(other.status).toBe(409);
    expect(other.extra.sameName).toEqual({ count: 1, mine: [] });

    // 自分が代表者を務めるチームなら、そのチームを知らせる
    const mine = (await registerTeam(app, S, userIds.founder, { ...base, name: `abcクラブ${key}` }).catch(
      (e: unknown) => e,
    )) as TeamError;
    expect(mine.extra.sameName).toEqual({ count: 1, mine: [{ id: first.id, name: first.name }] });

    const second = await registerTeam(app, S, userIds.stranger, { ...base, name: `ABC クラブ ${key}` }, { confirmSameName: true });
    expect(second.id).not.toBe(first.id);
  });

  it("ほかの協会の同名のチームは数えない", async () => {
    expect(await statusOf(() => registerTeam(app, S, userIds.founder, { ...base, name: "よその協会のチーム" }))).toBe("ok");
  });
});

describe("editTeam（チーム情報の編集）", () => {
  let teamId = "";
  beforeAll(async () => {
    teamId = (await registerTeam(app, S, userIds.founder, { ...base, name: `編集テスト ${random()}` })).id;
  });

  it("代表者は変えられる（協会員の登録をするチームかどうかも）", async () => {
    const updated = await editTeam(app, as(userIds.founder), S, teamId, {
      name: "編集後のチーム",
      kana: "へんしゅうご",
      contactPhone: "092-123-4567",
      membershipRenewalTarget: true,
    });
    expect(updated).toMatchObject({
      name: "編集後のチーム",
      kana: "へんしゅうご",
      contactPhone: "092-123-4567",
      membershipRenewalTarget: true,
    });
  });

  it("テナント管理者も変えられる", async () => {
    expect(await statusOf(() => editTeam(app, as(userIds.admin), S, teamId, { name: "管理者が直した" }))).toBe("ok");
  });

  it("代表者でない人は 403（入力が誤っていても 403 が先）", async () => {
    expect(await statusOf(() => editTeam(app, as(userIds.stranger), S, teamId, { name: "乗っ取り" }))).toBe(403);
    expect(await statusOf(() => editTeam(app, as(userIds.stranger), S, teamId, { name: "" }))).toBe(403);
  });

  it("別の協会のチーム ID を URL の協会の下で指定すると 404（テナント管理者でも）", async () => {
    expect(await statusOf(() => editTeam(app, as(userIds.admin), S, otherTeamId, { name: "x" }))).toBe(404);
    expect(await statusOf(() => editTeam(app, as(userIds.founder), S, "not-a-uuid", { name: "x" }))).toBe(404);
  });

  it("代表者でも入力が誤っていれば 400", async () => {
    const error = (await editTeam(app, as(userIds.founder), S, teamId, { name: "" }).catch((e: unknown) => e)) as TeamError;
    expect(error.status).toBe(400);
    expect(error.extra).toEqual({ field: "name" });
  });

  it("削除済みのチームは 404", async () => {
    const gone = await registerTeam(app, S, userIds.founder, { ...base, name: `削除テスト ${random()}` });
    await withTenantOn(owner, S, (tx) => tx.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, gone.id)));
    expect(await statusOf(() => editTeam(app, as(userIds.founder), S, gone.id, { name: "x" }))).toBe(404);
  });
});
