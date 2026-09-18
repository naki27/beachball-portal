import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, loginCodes, mailLogs, rateLimits, sessions, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { hashAttemptId, hashEmailForKey } from "@/lib/auth/login-code";
import { requestLoginCode } from "@/lib/auth/request-login-code";
import {
  ADMIN_IDLE_TAKEOVER_MS,
  activeSessionsOf,
  createSession,
  deleteSession,
  endUserSessions,
  isAssociationAdminAnywhere,
  loadSession,
  MINUTE_MS,
} from "@/lib/auth/session";
import { verifyLoginCode } from "@/lib/auth/verify-login-code";
import type { MailSender, OutgoingMail } from "@/lib/mail/types";

// テナント管理者の同時ログインの制限（設計書 §9.2 の受け入れ条件 P0）。時刻は now を渡して進める
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const IP = `10.2.0.${Math.floor(Math.random() * 250)}`;
const T0 = new Date("2026-06-01T00:00:00Z");
const TERMS = "2027-01-31";
const ADMIN_EMAIL = `admin-session-${random()}@example.com`;
const PLAYER_EMAIL = `player-session-${random()}@example.com`;
let adminUserId = "";
let playerUserId = "";

async function issue(email: string, now: Date): Promise<{ attemptId: string; code: string }> {
  const sent: OutgoingMail[] = [];
  const sender: MailSender = {
    async send(mail) {
      sent.push(mail);
      return {};
    },
  };
  const result = await requestLoginCode(app, sender, { email, ip: IP, associationName: null, now });
  if (result.kind !== "sent") throw new Error("発行できなかった");
  return { attemptId: result.attemptId, code: sent[0].subject.match(/(\d{6})$/)![1] };
}

async function login(email: string, now: Date) {
  const { attemptId, code } = await issue(email, now);
  return { code, attemptId, result: await verifyLoginCode(app, { attemptId, code, ip: IP, termsVersion: TERMS, now }) };
}

beforeAll(async () => {
  const [admin] = await owner.insert(users).values({ email: ADMIN_EMAIL, emailVerifiedAt: T0 }).returning({ id: users.id });
  adminUserId = admin.id;
  const [player] = await owner.insert(users).values({ email: PLAYER_EMAIL, emailVerifiedAt: T0 }).returning({ id: users.id });
  playerUserId = player.id;
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: adminUserId });
  });
});

afterAll(async () => {
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, adminUserId));
  });
  for (const [email, id] of [
    [ADMIN_EMAIL, adminUserId],
    [PLAYER_EMAIL, playerUserId],
  ]) {
    await owner.delete(sessions).where(eq(sessions.userId, id));
    await owner.delete(loginCodes).where(eq(loginCodes.email, email));
    await owner.delete(mailLogs).where(eq(mailLogs.toEmail, email));
    await owner.delete(users).where(eq(users.id, id));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:email:${hashEmailForKey(email)}`));
  }
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:ip:${IP}`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, "login_request:all"));
  await closeDb(app);
  await closeDb(owner);
});

describe("テナント管理者の同時ログインは 1 つまで（§9.2）", () => {
  it("判定は SECURITY DEFINER 関数で（RLS の下でも読める）", async () => {
    expect(await isAssociationAdminAnywhere(app, adminUserId)).toBe(true);
    expect(await isAssociationAdminAnywhere(app, playerUserId)).toBe(false);
  });

  it("端末 A でログイン中に端末 B は 409。A のセッションは切れない。A でログアウトすると同じ番号で B から入れる", async () => {
    const a = await login(ADMIN_EMAIL, T0);
    expect(a.result.ok).toBe(true);
    if (!a.result.ok) return;

    const t1 = new Date(T0.getTime() + 5 * MINUTE_MS);
    const b = await login(ADMIN_EMAIL, t1);
    expect(b.result).toEqual({ ok: false, reason: "admin_session_exists" });
    // A はそのまま
    expect(await loadSession(app, a.result.session.id, t1)).not.toBeNull();
    // B の番号は使用済みになっていない
    const [bCode] = await owner.select().from(loginCodes).where(eq(loginCodes.attemptHash, hashAttemptId(b.attemptId)));
    expect(bCode.usedAt).toBeNull();

    // A でログアウト → 同じ番号で B から入れる
    await deleteSession(app, a.result.session.id);
    const retry = await verifyLoginCode(app, { attemptId: b.attemptId, code: b.code, ip: IP, termsVersion: TERMS, now: t1 });
    expect(retry.ok).toBe(true);
    await endUserSessions(owner, adminUserId);
  });

  it("A の最後の操作から 30 分以上たっていれば B から入れ、A のセッションは終了する", async () => {
    const a = await login(ADMIN_EMAIL, T0);
    if (!a.result.ok) throw new Error("A でログインできない");
    const later = new Date(T0.getTime() + ADMIN_IDLE_TAKEOVER_MS + 1000);
    const b = await login(ADMIN_EMAIL, later);
    expect(b.result.ok).toBe(true);
    expect(await loadSession(app, a.result.session.id, later)).toBeNull();
    expect((await activeSessionsOf(owner, adminUserId, later)).length).toBe(1);
    await endUserSessions(owner, adminUserId);
  });

  it("代表者（テナント管理者ではない人）は複数の端末で同時にログインできる", async () => {
    const a = await login(PLAYER_EMAIL, T0);
    const b = await login(PLAYER_EMAIL, new Date(T0.getTime() + MINUTE_MS));
    expect(a.result.ok).toBe(true);
    expect(b.result.ok).toBe(true);
    expect((await activeSessionsOf(owner, playerUserId, T0)).length).toBe(2);
    await endUserSessions(owner, playerUserId);
  });

  it("テナント管理者のセッションは last_seen_at を 1 分に 1 回まで更新する。ほかの人は 1 日 1 回", async () => {
    const admin = await createSession(app, adminUserId, T0);
    expect((await loadSession(app, admin.id, new Date(T0.getTime() + 30_000)))?.lastSeenAt.getTime()).toBe(T0.getTime());
    const t = new Date(T0.getTime() + 61_000);
    expect((await loadSession(app, admin.id, t))?.lastSeenAt.getTime()).toBe(t.getTime());

    const player = await createSession(app, playerUserId, T0);
    expect((await loadSession(app, player.id, new Date(T0.getTime() + 61_000)))?.lastSeenAt.getTime()).toBe(T0.getTime());
    await endUserSessions(owner, adminUserId);
    await endUserSessions(owner, playerUserId);
  });

  it("まとめて終了: 操作したセッションだけ残せる", async () => {
    const keep = await createSession(app, playerUserId, T0);
    await createSession(app, playerUserId, T0);
    await createSession(app, playerUserId, T0);
    expect(await endUserSessions(app, playerUserId, { exceptSessionId: keep.id })).toBe(2);
    expect(await loadSession(app, keep.id, T0)).not.toBeNull();
    expect(await endUserSessions(app, playerUserId)).toBe(1);
  });
});
