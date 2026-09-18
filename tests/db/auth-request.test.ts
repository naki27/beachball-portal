import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { loginCodes, mailLogs, rateLimits, users } from "@/db/schema";
import { hashAttemptId, hashCode, hashEmailForKey } from "@/lib/auth/login-code";
import { REQUEST_LIMITS, requestLoginCode } from "@/lib/auth/request-login-code";
import type { MailSender, OutgoingMail } from "@/lib/mail/types";

// 確認番号の発行（§5.1・§9.2）。アプリ（app_user）で発行し、後片付けは app_owner
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const REGISTERED = `auth-req-registered-${random()}@example.com`;
const UNKNOWN = `auth-req-unknown-${random()}@example.com`;
const IP = `10.0.0.${Math.floor(Math.random() * 250)}`;

function recordingSender(): MailSender & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
      return { providerMessageId: "fake" };
    },
  };
}

beforeAll(async () => {
  await owner.insert(users).values({ email: REGISTERED, emailVerifiedAt: new Date() });
});

afterAll(async () => {
  for (const email of [REGISTERED, UNKNOWN]) {
    await owner.delete(loginCodes).where(eq(loginCodes.email, email));
    await owner.delete(mailLogs).where(eq(mailLogs.toEmail, email));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:email:${hashEmailForKey(email)}`));
  }
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:ip:${IP}`));
  await owner.delete(rateLimits).where(like(rateLimits.key, "login_request:all"));
  await owner.delete(users).where(eq(users.email, REGISTERED));
  await closeDb(app);
  await closeDb(owner);
});

describe("確認番号の発行", () => {
  it("未登録・登録済みで応答が同じ。番号は平文で残らず、メールの件名に番号が入る", async () => {
    const sender = recordingSender();
    const r1 = await requestLoginCode(app, sender, { email: UNKNOWN, ip: IP, associationName: "早良区協会" });
    const r2 = await requestLoginCode(app, sender, { email: REGISTERED, ip: IP, associationName: null });
    expect(r1.kind).toBe("sent");
    expect(r2.kind).toBe("sent");
    if (r1.kind !== "sent" || r2.kind !== "sent") return;
    expect(r1.resendAfterSeconds).toBe(r2.resendAfterSeconds);

    // メール: 件名に 6 桁。協会のページからなら【協会名】、そうでなければ【サイト名】
    const m1 = sender.sent.find((m) => m.to === UNKNOWN);
    const m2 = sender.sent.find((m) => m.to === REGISTERED);
    expect(m1?.subject).toMatch(/^【早良区協会】確認番号 \d{6}$/);
    expect(m2?.subject).toMatch(/^【.+】確認番号 \d{6}$/);
    expect(m1?.text).not.toMatch(/https?:\/\//); // 本文にリンクを載せない

    // DB: 番号そのものは残らない。HMAC(試行 ID + 番号) と一致する
    const code = m1!.subject.match(/(\d{6})$/)![1];
    const [row] = await owner.select().from(loginCodes).where(eq(loginCodes.email, UNKNOWN));
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toBe(hashCode(requireEnv("LOGIN_CODE_HMAC_KEY"), r1.attemptId, code));
    expect(row.attemptHash).toBe(hashAttemptId(r1.attemptId));
    expect(row.usedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // mail_logs には sent の記録だけ（番号は書かない）
    const [log] = await owner.select().from(mailLogs).where(eq(mailLogs.toEmail, UNKNOWN));
    expect(log.mailType).toBe("login_code");
    expect(log.status).toBe("sent");
    expect(JSON.stringify(log.params)).not.toContain(code);
  });

  it("再送は同じ試行 ID で発行し、待ち時間が 30 → 60 → 120 秒と延びる", async () => {
    const sender = recordingSender();
    const first = await requestLoginCode(app, sender, { email: UNKNOWN, ip: IP, associationName: null });
    if (first.kind !== "sent") throw new Error("sent ではない");
    const second = await requestLoginCode(app, sender, { email: UNKNOWN, ip: IP, attemptId: first.attemptId, associationName: null });
    const third = await requestLoginCode(app, sender, { email: UNKNOWN, ip: IP, attemptId: first.attemptId, associationName: null });
    expect(second).toMatchObject({ kind: "sent", attemptId: first.attemptId, resendAfterSeconds: 60 });
    expect(third).toMatchObject({ kind: "sent", attemptId: first.attemptId, resendAfterSeconds: 120 });
    const rows = await owner.select().from(loginCodes).where(eq(loginCodes.attemptHash, hashAttemptId(first.attemptId)));
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.usedAt === null)).toBe(true); // 再送しても前の番号は無効にしない
  });

  it("同じメールへの発行は 1 時間に 5 回まで。超えると次の枠の時刻を返す", async () => {
    const sender = recordingSender();
    const email = `auth-req-limit-${random()}@example.com`;
    let result;
    for (let i = 0; i < REQUEST_LIMITS.perEmailPerHour + 1; i++) {
      result = await requestLoginCode(app, sender, { email, ip: IP, associationName: null });
    }
    expect(result).toMatchObject({ kind: "rate_limited" });
    if (result?.kind === "rate_limited") expect(result.retryAt.getTime()).toBeGreaterThan(Date.now());
    expect(sender.sent.filter((m) => m.to === email).length).toBe(REQUEST_LIMITS.perEmailPerHour);
    await owner.delete(loginCodes).where(eq(loginCodes.email, email));
    await owner.delete(mailLogs).where(eq(mailLogs.toEmail, email));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:email:${hashEmailForKey(email)}`));
  });

  it("送信に失敗しても応答は同じで、mail_logs に failed が残る", async () => {
    const failing: MailSender = {
      async send() {
        throw new Error("smtp down");
      },
    };
    const email = `auth-req-fail-${random()}@example.com`;
    const result = await requestLoginCode(app, failing, { email, ip: IP, associationName: null });
    expect(result.kind).toBe("sent");
    const [log] = await owner.select().from(mailLogs).where(eq(mailLogs.toEmail, email));
    expect(log.status).toBe("failed");
    await owner.delete(loginCodes).where(eq(loginCodes.email, email));
    await owner.delete(mailLogs).where(eq(mailLogs.toEmail, email));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:email:${hashEmailForKey(email)}`));
  });
});
