import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  adminAccessLogs,
  associationAdminInvitations,
  associations,
  associationSlugHistory,
  categoryPresets,
  mailLogs,
  platformAdmins,
  sessions,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { createSession, loadSession } from "@/lib/auth/session";
import {
  createAssociationTenant,
  enterTenant,
  leaveTenant,
  PlatformError,
  updateAssociation,
} from "@/lib/platform/associations";
import { listAssociationAdmins, listAssociationStats } from "@/lib/repo/platform";
import { resolveAssociation } from "@/lib/resolve-association";

// 運営管理者とテナントの作成（設計書 §5.14）。操作は app_user、準備と後片付けは app_owner
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
// 「返事待ちの招待」の数は関数側で実時間の now() と比べるので、固定の過去の時刻にしない
const T0 = new Date();
let platformUserId = "";
let plainUserId = "";
const createdAssociationIds: string[] = [];

beforeAll(async () => {
  const [p] = await owner.insert(users).values({ email: `platform-${random()}@example.com`, emailVerifiedAt: T0 }).returning({ id: users.id });
  platformUserId = p.id;
  await owner.insert(platformAdmins).values({ userId: platformUserId, note: "test" });
  const [u] = await owner.insert(users).values({ email: `plain-${random()}@example.com`, emailVerifiedAt: T0 }).returning({ id: users.id });
  plainUserId = u.id;
});

afterAll(async () => {
  for (const id of createdAssociationIds) {
    await withTenantOn(owner, id, async (tx) => {
      await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, id));
      await tx.delete(associationAdminInvitations).where(eq(associationAdminInvitations.associationId, id));
      await tx.delete(associationSlugHistory).where(eq(associationSlugHistory.associationId, id));
    });
    await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.associationId, id));
    await owner.delete(mailLogs).where(eq(mailLogs.associationId, id));
    await owner.delete(associations).where(eq(associations.id, id));
  }
  await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.userId, platformUserId));
  await owner.delete(sessions).where(eq(sessions.userId, platformUserId));
  await owner.delete(platformAdmins).where(eq(platformAdmins.userId, platformUserId));
  await owner.delete(users).where(eq(users.id, platformUserId));
  await owner.delete(users).where(eq(users.id, plainUserId));
  await closeDb(app);
  await closeDb(owner);
});

describe("テナントの作成（§5.14）", () => {
  it("協会・プリセット 18 件・最初の管理者への招待・記録が 1 つのトランザクションで入る", async () => {
    const slug = `t-${random()}`;
    const { association, invitationIds } = await createAssociationTenant(
      app,
      platformUserId,
      { name: "  テスト協会  ", slug, fiscalYearStartMonth: 4, contactEmail: "Office@Example.com", adminEmails: ["A@example.com", "b@example.com", "a@example.com"] },
      T0,
    );
    createdAssociationIds.push(association.id);
    expect(association.name).toBe("テスト協会");
    expect(association.contactEmail).toBe("office@example.com");
    expect(invitationIds).toHaveLength(2); // 重複と大文字小文字はまとめる

    const presets = await withTenantOn(owner, association.id, (tx) =>
      tx.select().from(categoryPresets).where(eq(categoryPresets.associationId, association.id)),
    );
    expect(presets).toHaveLength(18);

    const invitations = await withTenantOn(owner, association.id, (tx) =>
      tx.select().from(associationAdminInvitations).where(eq(associationAdminInvitations.associationId, association.id)),
    );
    expect(invitations.map((i) => i.email).sort()).toEqual(["a@example.com", "b@example.com"]);
    expect(invitations.every((i) => i.status === "pending" && i.invitedBy === platformUserId)).toBe(true);
    expect(invitations[0].expiresAt.getTime()).toBe(T0.getTime() + 7 * 24 * 60 * 60 * 1000);

    const logs = await owner
      .select()
      .from(adminAccessLogs)
      .where(and(eq(adminAccessLogs.associationId, association.id), eq(adminAccessLogs.action, "create_association")));
    expect(logs).toHaveLength(1);
    expect(logs[0].userId).toBe(platformUserId);

    // 横断の件数（運営管理者だけ返る）
    const stats = (await listAssociationStats(app, platformUserId)).find((s) => s.associationId === association.id);
    expect(stats).toMatchObject({ teams: 0, members: 0, openTournaments: 0, admins: 0, pendingAdminInvitations: 2 });
    expect(await listAssociationStats(app, plainUserId)).toEqual([]);
    expect(await listAssociationAdmins(app, plainUserId)).toEqual([]);
  });

  it("入力の検査: 予約語・形式違い・管理者なし・使用済みのスラッグ", async () => {
    const base = { name: "x", fiscalYearStartMonth: 4, adminEmails: ["a@example.com"] };
    await expect(createAssociationTenant(app, platformUserId, { ...base, slug: "admin" })).rejects.toBeInstanceOf(PlatformError);
    await expect(createAssociationTenant(app, platformUserId, { ...base, slug: "Bad Slug" })).rejects.toMatchObject({ status: 400, field: "slug" });
    await expect(createAssociationTenant(app, platformUserId, { ...base, slug: `t-${random()}`, adminEmails: [] })).rejects.toMatchObject({ field: "adminEmails" });
    await expect(createAssociationTenant(app, platformUserId, { ...base, slug: `t-${random()}`, adminEmails: ["nope"] })).rejects.toMatchObject({ field: "adminEmails" });
    await expect(createAssociationTenant(app, platformUserId, { ...base, slug: "sawara" })).rejects.toMatchObject({ status: 409, field: "slug" });
    await expect(createAssociationTenant(app, platformUserId, { ...base, name: " ", slug: `t-${random()}` })).rejects.toMatchObject({ field: "name" });
  });
});

describe("スラッグの変更（§5.14「URL とテナント」）", () => {
  it("旧スラッグは履歴に残り、解決すると新しいスラッグへ転送。旧スラッグは別の協会にも使えない", async () => {
    const oldSlug = `t-${random()}`;
    const newSlug = `t-${random()}`;
    const { association } = await createAssociationTenant(app, platformUserId, { name: "改名する協会", slug: oldSlug, adminEmails: ["c@example.com"] }, T0);
    createdAssociationIds.push(association.id);

    const updated = await updateAssociation(app, platformUserId, association.id, { slug: newSlug, name: "改名した協会" });
    expect(updated.slug).toBe(newSlug);
    expect(updated.name).toBe("改名した協会");
    expect(await resolveAssociation(oldSlug)).toMatchObject({ kind: "redirect", currentSlug: newSlug });
    expect(await resolveAssociation(newSlug)).toMatchObject({ kind: "found" });

    await expect(createAssociationTenant(app, platformUserId, { name: "y", slug: oldSlug, adminEmails: ["d@example.com"] })).rejects.toMatchObject({ status: 409 });
    await expect(updateAssociation(app, platformUserId, association.id, { slug: "sawara" })).rejects.toMatchObject({ status: 409 });

    const logs = await owner.select().from(adminAccessLogs).where(and(eq(adminAccessLogs.associationId, association.id), eq(adminAccessLogs.action, "change_slug")));
    expect(logs).toHaveLength(1);
  });
});

describe("協会に切り替えて入る・出る（§5.14「運営管理者」）", () => {
  it("セッションに入った協会と期限（1 時間）が入り、出ると消える。記録が残る", async () => {
    const { association } = await createAssociationTenant(app, platformUserId, { name: "入る協会", slug: `t-${random()}`, adminEmails: ["e@example.com"] }, T0);
    createdAssociationIds.push(association.id);
    const session = await createSession(app, platformUserId, T0);

    const until = await enterTenant(app, platformUserId, session.id, association.id, T0);
    expect(until.getTime()).toBe(T0.getTime() + 60 * 60 * 1000);
    const entered = await loadSession(app, session.id, T0);
    expect(entered?.enteredAssociationId).toBe(association.id);
    expect(entered?.enteredUntil?.getTime()).toBe(until.getTime());

    await leaveTenant(app, platformUserId, session.id, association.id);
    const left = await loadSession(app, session.id, T0);
    expect(left?.enteredAssociationId).toBeNull();
    expect(left?.enteredUntil).toBeNull();

    const actions = (await owner.select().from(adminAccessLogs).where(eq(adminAccessLogs.associationId, association.id))).map((l) => l.action).sort();
    expect(actions).toEqual(["create_association", "enter_tenant", "leave_tenant"]);
  });
});
