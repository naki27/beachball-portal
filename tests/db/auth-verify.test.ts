import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { loginCodes, mailLogs, rateLimits, sessions, users } from "@/db/schema";
import { generateAttemptId, hashAttemptId, hashEmailForKey } from "@/lib/auth/login-code";
import { requestLoginCode } from "@/lib/auth/request-login-code";
import { createSession, DAY_MS, hashSessionId, loadSession, SESSION_ABSOLUTE_DAYS } from "@/lib/auth/session";
import { verifyLoginCode } from "@/lib/auth/verify-login-code";
import type { MailSender, OutgoingMail } from "@/lib/mail/types";

// 確認番号の照合とセッション（設計書 §9.2 の受け入れ条件）。時刻は now を渡して進める（テスト用の時計）
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const IP = `10.1.0.${Math.floor(Math.random() * 250)}`;
const T0 = new Date("2026-05-01T00:00:00Z");
const TERMS = "2027-01-31";
const createdEmails: string[] = [];

function newEmail(): string {
  const email = `auth-verify-${random()}@example.com`;
  createdEmails.push(email);
  return email;
}

// 発行して、メールの件名から番号を取り出す
async function issue(email: string, attemptId?: string, now: Date = T0): Promise<{ attemptId: string; code: string }> {
  const sent: OutgoingMail[] = [];
  const sender: MailSender = {
    async send(mail) {
      sent.push(mail);
      return {};
    },
  };
  const result = await requestLoginCode(app, sender, { email, ip: IP, attemptId, associationName: null, now });
  if (result.kind !== "sent") throw new Error("発行できなかった");
  const code = sent[0].subject.match(/(\d{6})$/)![1];
  return { attemptId: result.attemptId, code };
}

afterAll(async () => {
  for (const email of createdEmails) {
    const rows = await owner.select({ id: users.id }).from(users).where(eq(users.email, email));
    for (const u of rows) await owner.delete(sessions).where(eq(sessions.userId, u.id));
    await owner.delete(users).where(eq(users.email, email));
    await owner.delete(loginCodes).where(eq(loginCodes.email, email));
    await owner.delete(mailLogs).where(eq(mailLogs.toEmail, email));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:email:${hashEmailForKey(email)}`));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_verify:email:${hashEmailForKey(email)}`));
  }
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:ip:${IP}`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_verify:ip:${IP}`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, "login_request:all"));
  await closeDb(app);
  await closeDb(owner);
});

describe("確認番号の照合", () => {
  it("正しい番号でログインでき、未登録なら users が作られる（同意の版と日時）。同じ番号は 1 回しか使えない", async () => {
    const email = newEmail();
    const { attemptId, code } = await issue(email);
    const result = await verifyLoginCode(app, { attemptId, code, ip: IP, termsVersion: TERMS, now: T0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isNewUser).toBe(true);

    const [user] = await owner.select().from(users).where(eq(users.id, result.userId));
    expect(user.email).toBe(email);
    expect(user.emailVerifiedAt?.getTime()).toBe(T0.getTime());
    expect(user.termsVersion).toBe(TERMS);
    expect(user.termsAcceptedAt?.getTime()).toBe(T0.getTime());
    expect(user.lastLoginAt?.getTime()).toBe(T0.getTime());

    // セッション: 10 日・上限 90 日・DB はハッシュ
    expect(result.session.row.expiresAt.getTime()).toBe(T0.getTime() + 10 * DAY_MS);
    expect(result.session.row.absoluteExpiresAt.getTime()).toBe(T0.getTime() + SESSION_ABSOLUTE_DAYS * DAY_MS);
    expect(result.session.row.sessionHash).toBe(hashSessionId(result.session.id));
    expect(result.session.row.sessionHash).not.toContain(result.session.id);

    // 一回性
    const again = await verifyLoginCode(app, { attemptId, code, ip: IP, termsVersion: TERMS, now: T0 });
    expect(again).toEqual({ ok: false, reason: "invalid", remaining: 0 });

    // 登録済みでもう一度ログイン: users は増えない
    const second = await issue(email, undefined, new Date(T0.getTime() + 60_000));
    const r2 = await verifyLoginCode(app, { ...second, ip: IP, termsVersion: TERMS, now: new Date(T0.getTime() + 60_000) });
    expect(r2).toMatchObject({ ok: true, isNewUser: false, userId: result.userId });
    expect((await owner.select().from(users).where(eq(users.email, email))).length).toBe(1);
  });

  it("10 分を過ぎた番号は使えない", async () => {
    const email = newEmail();
    const { attemptId, code } = await issue(email);
    const late = new Date(T0.getTime() + 10 * 60_000 + 1);
    expect(await verifyLoginCode(app, { attemptId, code, ip: IP, termsVersion: TERMS, now: late })).toEqual({ ok: false, reason: "invalid", remaining: 0 });
  });

  it("間違いは試行につき 5 回まで。超えたら試行の番号をすべて無効にする", async () => {
    const email = newEmail();
    const { attemptId, code } = await issue(email);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 1; i <= 5; i++) {
      const r = await verifyLoginCode(app, { attemptId, code: wrong, ip: IP, termsVersion: TERMS, now: T0 });
      expect(r).toEqual({ ok: false, reason: "invalid", remaining: 5 - i });
    }
    // 正しい番号でももう入れない
    expect(await verifyLoginCode(app, { attemptId, code, ip: IP, termsVersion: TERMS, now: T0 })).toEqual({ ok: false, reason: "invalid", remaining: 0 });
    const rows = await owner.select().from(loginCodes).where(eq(loginCodes.email, email));
    expect(rows.every((r) => r.usedAt !== null)).toBe(true);
  });

  it("他人の試行 ID からは、その人の番号を無効にできない", async () => {
    const email = newEmail();
    const { attemptId, code } = await issue(email);
    const stranger = generateAttemptId();
    for (let i = 0; i < 6; i++) {
      expect(await verifyLoginCode(app, { attemptId: stranger, code, ip: IP, termsVersion: TERMS, now: T0 })).toEqual({ ok: false, reason: "invalid", remaining: 0 });
    }
    expect(await verifyLoginCode(app, { attemptId: null, code, ip: IP, termsVersion: TERMS, now: T0 })).toMatchObject({ ok: false });
    // 本人の試行では入れる
    expect(await verifyLoginCode(app, { attemptId, code, ip: IP, termsVersion: TERMS, now: T0 })).toMatchObject({ ok: true });
  });

  it("再送しても前の番号は無効にならず、直近 3 個までのどれでも入れる。一致したら同じメールの他の番号は無効", async () => {
    const email = newEmail();
    const first = await issue(email, undefined, T0);
    const second = await issue(email, first.attemptId, new Date(T0.getTime() + 1000));
    const third = await issue(email, first.attemptId, new Date(T0.getTime() + 2000));
    const fourth = await issue(email, first.attemptId, new Date(T0.getTime() + 3000));
    const now = new Date(T0.getTime() + 4000);
    // 4 個目が出た時点で、1 個目は「直近 3 個」から外れる
    expect(await verifyLoginCode(app, { attemptId: first.attemptId, code: first.code, ip: IP, termsVersion: TERMS, now })).toMatchObject({ ok: false });
    // 2 個目（直近 3 個の中で最も古い）で入れる
    const r = await verifyLoginCode(app, { attemptId: first.attemptId, code: second.code, ip: IP, termsVersion: TERMS, now });
    expect(r).toMatchObject({ ok: true });
    // 残り（3・4 個目）も無効になっている
    const open = await owner.select().from(loginCodes).where(and(eq(loginCodes.email, email), isNull(loginCodes.usedAt)));
    expect(open).toHaveLength(0);
    expect(third.code).toBeDefined();
    expect(fourth.code).toBeDefined();
    expect(second.attemptId).toBe(first.attemptId);
    expect(hashAttemptId(first.attemptId)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("セッション（§9.2）", () => {
  it("10 日で失効。アクセスで延長するが、DB を書くのは 1 日に 1 回。90 日を超えたら延長しない", async () => {
    const email = newEmail();
    const [user] = await owner.insert(users).values({ email, emailVerifiedAt: T0 }).returning({ id: users.id });
    const { id, row } = await createSession(app, user.id, T0);
    expect(row.expiresAt.getTime()).toBe(T0.getTime() + 10 * DAY_MS);

    // 半日後: 有効。DB は書かない（last_seen_at そのまま）
    const halfDay = await loadSession(app, id, new Date(T0.getTime() + DAY_MS / 2));
    expect(halfDay?.lastSeenAt.getTime()).toBe(T0.getTime());
    expect(halfDay?.expiresAt.getTime()).toBe(T0.getTime() + 10 * DAY_MS);

    // 2 日後: 延長（expires = now + 10 日、last_seen = now）
    const twoDays = new Date(T0.getTime() + 2 * DAY_MS);
    const extended = await loadSession(app, id, twoDays);
    expect(extended?.lastSeenAt.getTime()).toBe(twoDays.getTime());
    expect(extended?.expiresAt.getTime()).toBe(twoDays.getTime() + 10 * DAY_MS);

    // 最後の延長から 10 日を超えたら null
    expect(await loadSession(app, id, new Date(twoDays.getTime() + 10 * DAY_MS + 1))).toBeNull();

    // 90 日の上限: 数日おきに使い続けていても、発行から 90 日を過ぎたら入れない
    const { id: id2 } = await createSession(app, user.id, T0);
    for (let d = 5; d <= 85; d += 5) {
      expect(await loadSession(app, id2, new Date(T0.getTime() + d * DAY_MS))).not.toBeNull();
    }
    const day89 = await loadSession(app, id2, new Date(T0.getTime() + 89 * DAY_MS));
    expect(day89?.expiresAt.getTime()).toBe(T0.getTime() + SESSION_ABSOLUTE_DAYS * DAY_MS); // 上限で頭打ち
    expect(await loadSession(app, id2, new Date(T0.getTime() + SESSION_ABSOLUTE_DAYS * DAY_MS + 1))).toBeNull();
    // 存在しない ID
    expect(await loadSession(app, "nope", T0)).toBeNull();
  });
});
