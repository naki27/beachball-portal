import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  adminAccessLogs,
  associationAdminInvitations,
  loginCodes,
  mailLogs,
  members,
  rateLimits,
  sessions,
  teamInvitations,
  teams,
  users,
} from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { runDailyJob } from "@/lib/jobs/daily";
import type { StorageAdapter } from "@/lib/storage/types";
import { normalizeName } from "@/lib/normalize";
import { invitePlayer } from "@/lib/teams/invitations";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 日次ジョブ（設計書 §6.5.1 の ③④⑤・§12「記録の保存期間」）。期限を過ぎたものだけが処理されることを確かめる
// ほかのテストの行を巻き込まないよう、「今」を 2020-01-15 にして、古い日付の行だけを作る
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `日次${random()}`;
const NOW = new Date("2020-01-15T00:00:00Z");
const at = (iso: string) => new Date(iso);
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 日次ジョブ ②（申込一覧のバックアップ）は保存先を差し替えて、.local-storage/ を触らせない
const storage: StorageAdapter = {
  driver: "local",
  async put() {},
  async get() {
    return null;
  },
  async head() {
    return null;
  },
  async remove() {},
  async list() {
    return [];
  },
  publicUrl: (key) => key,
};

const ids = { admin: "", player: "", deleted: "" };
const emails: Record<keyof typeof ids, string> = { admin: "", player: "", deleted: "" };
let teamId = "";
let expiredInvitation = "";
let liveInvitation = "";
let expiredAdminInvitation = "";
let oldAdminInvitation = "";
let oldTeamInvitation = "";
const keys = { old: `daily-test-old:${random()}`, fresh: `daily-test-fresh:${random()}` };

beforeAll(async () => {
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    emails[key] = `daily-${key}-${random()}@example.com`;
    const [u] = await owner
      .insert(users)
      .values({ email: emails[key], emailVerifiedAt: NOW, deletedAt: key === "deleted" ? NOW : null })
      .returning({ id: users.id });
    ids[key] = u.id;
  }

  const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false };
  teamId = (await registerTeam(app, S, ids.admin, { ...base, name: `${tag} チーム` })).id;
  const taro = await addPlayer(app, as(ids.admin), S, teamId, { name: `${tag} 太郎`, kana: "", birthDate: "1992-02-02", sex: "male" });
  const jiro = await addPlayer(app, as(ids.admin), S, teamId, { name: `${tag} 次郎`, kana: "", birthDate: "1993-03-03", sex: "male" });

  // 期限が切れた招待（2019-12-04 まで）と、まだ返事待ちの招待（2020-01-18 まで）
  expiredInvitation = (await invitePlayer(app, as(ids.admin), S, teamId, { memberId: taro.memberId, email: emails.player }, at("2019-12-01T00:00:00Z"))).invitationId;
  liveInvitation = (await invitePlayer(app, as(ids.admin), S, teamId, { memberId: jiro.memberId, email: emails.player }, at("2020-01-15T00:00:00Z"))).invitationId;

  await withTenantOn(owner, S, async (tx) => {
    // 保存期間（1 年）を過ぎた招待: 返事をした日が 2018-12-31
    const [oldTeam] = await tx
      .insert(teamInvitations)
      .values({
        associationId: S, teamId, kind: "admin", email: emails.player, invitedBy: ids.admin,
        status: "rejected", expiresAt: at("2018-12-20T00:00:00Z"), respondedAt: at("2018-12-31T00:00:00Z"),
      })
      .returning({ id: teamInvitations.id });
    oldTeamInvitation = oldTeam.id;

    const [expiredAdmin] = await tx
      .insert(associationAdminInvitations)
      .values({ associationId: S, email: `daily-admin-${random()}@example.com`, invitedBy: ids.deleted, status: "pending", expiresAt: at("2019-12-10T00:00:00Z") })
      .returning({ id: associationAdminInvitations.id });
    expiredAdminInvitation = expiredAdmin.id;

    const [oldAdmin] = await tx
      .insert(associationAdminInvitations)
      .values({ associationId: S, email: `daily-admin-${random()}@example.com`, invitedBy: ids.admin, status: "cancelled", expiresAt: at("2018-11-01T00:00:00Z"), respondedAt: at("2018-11-02T00:00:00Z") })
      .returning({ id: associationAdminInvitations.id });
    oldAdminInvitation = oldAdmin.id;
  });

  // 確認番号・セッション・レート制限・記録（古いものと新しいもの）
  await owner.insert(loginCodes).values([
    { email: emails.admin, attemptHash: `daily-old-${random()}`, codeHash: "x", expiresAt: at("2020-01-14T00:00:00Z") },
    { email: emails.admin, attemptHash: `daily-fresh-${random()}`, codeHash: "x", expiresAt: at("2020-01-16T00:00:00Z") },
  ]);
  await owner.insert(sessions).values([
    { userId: ids.admin, sessionHash: `daily-expired-${random()}`, expiresAt: at("2020-01-10T00:00:00Z"), absoluteExpiresAt: at("2020-03-01T00:00:00Z") },
    { userId: ids.admin, sessionHash: `daily-absolute-${random()}`, expiresAt: at("2020-01-20T00:00:00Z"), absoluteExpiresAt: at("2020-01-14T00:00:00Z") },
    { userId: ids.admin, sessionHash: `daily-live-${random()}`, expiresAt: at("2020-01-20T00:00:00Z"), absoluteExpiresAt: at("2020-03-01T00:00:00Z") },
  ]);
  await owner.insert(rateLimits).values([
    { key: keys.old, windowStart: at("2020-01-13T00:00:00Z"), count: 3 },
    { key: keys.fresh, windowStart: at("2020-01-14T12:00:00Z"), count: 1 },
  ]);
  await owner.insert(mailLogs).values([
    { associationId: S, mailType: "test", toEmail: emails.admin, status: "sent", createdAt: at("2018-06-01T00:00:00Z") },
    { associationId: S, mailType: "test", toEmail: emails.admin, status: "sent", createdAt: at("2019-06-01T00:00:00Z") },
  ]);
  await owner.insert(adminAccessLogs).values([
    { userId: ids.admin, associationId: S, action: "enter_tenant", createdAt: at("2016-01-01T00:00:00Z") },
    { userId: ids.admin, associationId: S, action: "enter_tenant", createdAt: at("2018-01-01T00:00:00Z") },
  ]);
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(teams).where(eq(teams.createdBy, ids.admin));
    await tx.delete(members).where(and(eq(members.associationId, S), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    await tx.delete(associationAdminInvitations).where(eq(associationAdminInvitations.invitedBy, ids.admin));
    await tx.delete(associationAdminInvitations).where(eq(associationAdminInvitations.invitedBy, ids.deleted));
  });
  await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, Object.values(emails)));
  await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.userId, ids.admin));
  await owner.delete(rateLimits).where(inArray(rateLimits.key, [keys.old, keys.fresh]));
  await owner.delete(sessions).where(eq(sessions.userId, ids.admin));
  await owner.delete(loginCodes).where(eq(loginCodes.email, emails.admin));
  await owner.delete(users).where(inArray(users.id, Object.values(ids)));
  await closeDb(owner);
  await closeDb(app);
  await closeDb(job);
});

async function invitationStatus(id: string): Promise<string | undefined> {
  const [row] = await withTenantOn(owner, S, (tx) => tx.select({ status: teamInvitations.status }).from(teamInvitations).where(eq(teamInvitations.id, id)));
  return row?.status;
}

async function adminInvitationStatus(id: string): Promise<string | undefined> {
  const [row] = await withTenantOn(owner, S, (tx) =>
    tx.select({ status: associationAdminInvitations.status }).from(associationAdminInvitations).where(eq(associationAdminInvitations.id, id)),
  );
  return row?.status;
}

describe("日次ジョブ", () => {
  it("期限を過ぎたものだけを処理する（確認番号・セッション・レート制限・招待・保存期間）", async () => {
    const result = await runDailyJob(job, { now: NOW, storage });

    // ③ 期限切れの物理削除
    expect(result.loginCodes).toBeGreaterThanOrEqual(1);
    const codes = await owner.select().from(loginCodes).where(eq(loginCodes.email, emails.admin));
    expect(codes.map((c) => c.expiresAt.toISOString())).toEqual(["2020-01-16T00:00:00.000Z"]);

    const live = await owner.select({ hash: sessions.sessionHash }).from(sessions).where(eq(sessions.userId, ids.admin));
    expect(live).toHaveLength(1);
    expect(live[0].hash).toMatch(/^daily-live-/);

    const limits = await owner.select({ key: rateLimits.key }).from(rateLimits).where(inArray(rateLimits.key, [keys.old, keys.fresh]));
    expect(limits.map((l) => l.key)).toEqual([keys.fresh]);

    // ④ 期限切れの招待を expired にする（返事待ちの期限内のものは触らない）
    expect(await invitationStatus(expiredInvitation)).toBe("expired");
    expect(await invitationStatus(liveInvitation)).toBe("pending");
    expect(await adminInvitationStatus(expiredAdminInvitation)).toBe("expired");
    expect(result.expiredTeamInvitations).toBeGreaterThanOrEqual(1);
    expect(result.expiredAdminInvitations).toBeGreaterThanOrEqual(1);

    // ⑤ 保存期間（招待は 1 年・送信記録は 1 年・操作記録は 3 年）を過ぎた記録の物理削除
    expect(await invitationStatus(oldTeamInvitation)).toBeUndefined();
    expect(await adminInvitationStatus(oldAdminInvitation)).toBeUndefined();
    const mails = await owner
      .select({ createdAt: mailLogs.createdAt })
      .from(mailLogs)
      .where(and(eq(mailLogs.toEmail, emails.admin), eq(mailLogs.mailType, "test")));
    expect(mails.map((m) => m.createdAt.getUTCFullYear())).toEqual([2019]);
    const logs = await owner.select({ createdAt: adminAccessLogs.createdAt }).from(adminAccessLogs).where(eq(adminAccessLogs.userId, ids.admin));
    expect(logs.map((l) => l.createdAt.getUTCFullYear())).toEqual([2018]);
  });

  it("期限切れの知らせは招待した人に積む（削除済みのアカウントには積まない）", async () => {
    const queued = await owner
      .select({ mailType: mailLogs.mailType, toEmail: mailLogs.toEmail })
      .from(mailLogs)
      .where(and(eq(mailLogs.toEmail, emails.admin), eq(mailLogs.mailType, "team_invitation_expired")));
    expect(queued).toHaveLength(1);

    // 招待した人が削除済みの協会の管理者の招待では、知らせを積まない（§5.19）
    const toDeleted = await owner.select().from(mailLogs).where(eq(mailLogs.toEmail, emails.deleted));
    expect(toDeleted).toHaveLength(0);
  });

  it("もう一度流しても二重に処理しない", async () => {
    const again = await runDailyJob(job, { now: NOW, storage });
    expect(again.expiredTeamInvitations).toBe(0);
    expect(again.expiredAdminInvitations).toBe(0);
    const queued = await owner.select().from(mailLogs).where(and(eq(mailLogs.toEmail, emails.admin), eq(mailLogs.mailType, "team_invitation_expired")));
    expect(queued).toHaveLength(1);
  });
});
