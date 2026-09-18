import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, teamAdmins, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { listAllAssociations, listMyAssociations } from "@/lib/repo/associations";
import { findUserProfile, updateDisplayName } from "@/lib/repo/users";

// 協会をまたぐ画面（/・/mypage・切り替えメニュー）の協会の列挙（設計書 §5.14）と表示名の変更（§5.3）
// 準備と後片付けは app_owner、検査は app_user
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 10);

let otherId = "";
let unrelatedId = "";
let userId = "";
let strangerId = "";
let teamId = "";

beforeAll(async () => {
  const [other] = await owner
    .insert(associations)
    .values({ name: "あいう協会（テスト）", slug: `my-assoc-${random()}` })
    .returning({ id: associations.id });
  otherId = other.id;
  const [unrelated] = await owner
    .insert(associations)
    .values({ name: "関わりのない協会（テスト）", slug: `my-assoc-${random()}` })
    .returning({ id: associations.id });
  unrelatedId = unrelated.id;
  const [user] = await owner.insert(users).values({ email: `my-assoc-${random()}@example.com` }).returning({ id: users.id });
  userId = user.id;
  const [stranger] = await owner.insert(users).values({ email: `my-assoc-${random()}@example.com` }).returning({ id: users.id });
  strangerId = stranger.id;

  // 早良区協会ではチームの代表者、もう 1 つの協会では協会の管理者
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ associationId: SAWARA_ASSOCIATION_ID, name: `協会一覧テスト ${random()}` })
      .returning({ id: teams.id });
    teamId = team.id;
    await tx.insert(teamAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, teamId, userId });
  });
  await withTenantOn(owner, otherId, (tx) => tx.insert(associationAdmins).values({ associationId: otherId, userId }));
});

afterAll(async () => {
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.delete(teamAdmins).where(eq(teamAdmins.teamId, teamId));
    await tx.delete(teams).where(eq(teams.id, teamId));
  });
  await withTenantOn(owner, otherId, (tx) => tx.delete(associationAdmins).where(eq(associationAdmins.associationId, otherId)));
  await owner.delete(users).where(inArray(users.id, [userId, strangerId]));
  await owner.delete(associations).where(inArray(associations.id, [otherId, unrelatedId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("listMyAssociations", () => {
  it("役割を持つ協会だけを名前の順に返す（関わりのない協会は出ない）", async () => {
    const list = await listMyAssociations(app, userId);
    expect(list.map((a) => a.id)).toEqual([otherId, SAWARA_ASSOCIATION_ID]);
    expect(list.map((a) => a.id)).not.toContain(unrelatedId);
  });

  it("代表者を外されると、その協会は出なくなる", async () => {
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
      tx.update(teamAdmins).set({ revokedAt: new Date() }).where(eq(teamAdmins.teamId, teamId)),
    );
    try {
      expect((await listMyAssociations(app, userId)).map((a) => a.id)).toEqual([otherId]);
    } finally {
      await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
        tx.update(teamAdmins).set({ revokedAt: null }).where(eq(teamAdmins.teamId, teamId)),
      );
    }
  });

  it("役割のない人は空", async () => {
    expect(await listMyAssociations(app, strangerId)).toEqual([]);
  });

  it("app.user_id は SET LOCAL なので、次の問い合わせに残らない", async () => {
    await listMyAssociations(app, userId);
    const rows = await listMyAssociations(app, strangerId);
    expect(rows).toEqual([]);
  });
});

describe("listAllAssociations", () => {
  it("すべての協会（運営管理者の切り替えメニュー用）", async () => {
    const ids = (await listAllAssociations(app)).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([SAWARA_ASSOCIATION_ID, otherId, unrelatedId]));
  });
});

describe("updateDisplayName", () => {
  it("表示名を変え、null で消せる", async () => {
    await updateDisplayName(app, userId, "山田 太郎");
    expect((await findUserProfile(app, userId))?.displayName).toBe("山田 太郎");
    await updateDisplayName(app, userId, null);
    expect((await findUserProfile(app, userId))?.displayName).toBeNull();
  });
});
