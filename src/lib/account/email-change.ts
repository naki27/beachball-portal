import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { requireEnv } from "@/db/env";
import { loginCodes, mailLogs, users } from "@/db/schema";
import {
  generateAttemptId,
  generateCode,
  hashAttemptId,
  hashCode,
  hashEmailForKey,
  loginCodeTtlMinutes,
} from "@/lib/auth/login-code";
import { normalizeEmail } from "@/lib/auth/login-input";
import { matchLoginCode } from "@/lib/auth/match-code";
import { consumeRateLimits, HOUR_MS } from "@/lib/auth/rate-limit";
import { endUserSessions } from "@/lib/auth/session";
import { REQUEST_LIMITS, RESEND_WAIT_SECONDS } from "@/lib/auth/request-login-code";
import { enqueueMail } from "@/lib/mail/outbox";
import { composeLoginCodeMail, mailBranding } from "@/lib/mail/templates";
import type { MailSender } from "@/lib/mail/types";

// メールアドレスの変更（設計書 §5.19・§9.2）
// 新しいアドレスに確認番号（login_codes.purpose = 'email_change'）→ 番号で確定 → 古いアドレスに知らせる
// 使われているアドレスかどうかは、番号を入れたあとに調べる（入力の時点では誰のアドレスか分からないようにする）
// 確定したら、操作したセッション以外のそのユーザーのセッションをすべて終了する

export type RequestEmailChangeInput = {
  userId: string;
  newEmail: string;
  ip: string;
  // 再送のとき、Cookie にある試行 ID
  attemptId?: string | null;
  now?: Date;
};

export type RequestEmailChangeResult =
  | { kind: "sent"; attemptId: string; resendAfterSeconds: number }
  | { kind: "invalid"; message: string }
  | { kind: "rate_limited"; retryAt: Date };

export async function requestEmailChange(
  db: Db,
  sender: MailSender,
  input: RequestEmailChangeInput,
): Promise<RequestEmailChangeResult> {
  const now = input.now ?? new Date();
  const email = normalizeEmail(input.newEmail);
  if (!email) return { kind: "invalid", message: "メールアドレスの形で入力してください" };

  const [me] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!me) return { kind: "invalid", message: "アカウントが見つかりません" };
  if (me.email.toLowerCase() === email.toLowerCase()) {
    return { kind: "invalid", message: "いまお使いのメールアドレスと同じです" };
  }

  // 発行の上限はログインと同じ（§9.2）。宛先・IP・全体で数える
  const limited = await consumeRateLimits(
    db,
    [
      { key: `login_request:email:${hashEmailForKey(email)}`, limit: REQUEST_LIMITS.perEmailPerHour, windowMs: HOUR_MS },
      { key: `login_request:ip:${input.ip}`, limit: REQUEST_LIMITS.perIpPerHour, windowMs: HOUR_MS },
      { key: "login_request:all", limit: REQUEST_LIMITS.totalPerHour, windowMs: HOUR_MS },
    ],
    now,
  );
  if (!limited.allowed) return { kind: "rate_limited", retryAt: limited.retryAt };

  const hmacKey = requireEnv("LOGIN_CODE_HMAC_KEY");
  const ttlMinutes = loginCodeTtlMinutes();
  const attemptId = input.attemptId || generateAttemptId();
  const attemptHash = hashAttemptId(attemptId);
  const code = generateCode();

  await db.insert(loginCodes).values({
    purpose: "email_change",
    userId: input.userId,
    email,
    attemptHash,
    codeHash: hashCode(hmacKey, attemptId, code),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
  });

  const issued = await db
    .select({ id: loginCodes.id })
    .from(loginCodes)
    .where(and(eq(loginCodes.attemptHash, attemptHash), gt(loginCodes.expiresAt, now)));
  const resendAfterSeconds = RESEND_WAIT_SECONDS[Math.min(issued.length, RESEND_WAIT_SECONDS.length) - 1];

  // 確認番号は応答を返す前に送る（§11「送り方」）。本文にも記録にも番号は残さない
  const mail = composeLoginCodeMail({ code, ttlMinutes, associationName: null, purpose: "email_change" });
  let status: "sent" | "failed" = "sent";
  let providerMessageId: string | null = null;
  let error: string | null = null;
  try {
    // 協会に属さないメール（差出人名はサイト名、返信先は CONTACT_TO）
    providerMessageId = (await sender.send({ to: email, ...mailBranding(null), ...mail })).providerMessageId ?? null;
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.name : "send failed";
  }
  await db.insert(mailLogs).values({
    id: crypto.randomUUID(),
    associationId: null,
    mailType: "email_change_code",
    toEmail: email,
    userId: input.userId,
    params: {},
    status,
    attempts: 1,
    sentAt: status === "sent" ? now : null,
    providerMessageId,
    error,
  });

  return { kind: "sent", attemptId, resendAfterSeconds };
}

export type ConfirmEmailChangeInput = {
  userId: string;
  attemptId: string | null;
  code: string;
  ip: string;
  // 残すセッション（いま操作している端末の Cookie の値）
  sessionId: string;
  now?: Date;
};

export type ConfirmEmailChangeResult =
  | { ok: true; email: string; endedSessions: number }
  | { ok: false; reason: "invalid"; remaining: number }
  | { ok: false; reason: "taken" };

export async function confirmEmailChange(db: Db, input: ConfirmEmailChangeInput): Promise<ConfirmEmailChangeResult> {
  const now = input.now ?? new Date();
  const hmacKey = requireEnv("LOGIN_CODE_HMAC_KEY");

  return db.transaction(async (tx) => {
    const match = await matchLoginCode(tx, {
      attemptId: input.attemptId,
      code: input.code,
      purpose: "email_change",
      userId: input.userId,
      ip: input.ip,
      hmacKey,
      now,
    });
    if (!match.ok) return { ok: false, reason: "invalid", remaining: match.remaining };
    const newEmail = match.row.email;

    const [me] = await tx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!me) return { ok: false, reason: "invalid", remaining: 0 };

    // 番号は当たったので使い切る（この人の変更の番号をまとめて無効にする）
    await tx
      .update(loginCodes)
      .set({ usedAt: now })
      .where(and(eq(loginCodes.userId, input.userId), eq(loginCodes.purpose, "email_change"), isNull(loginCodes.usedAt)));

    // 別のアカウントで使われていたら変更しない（アカウントをまとめる機能は作らない・§5.19）
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, newEmail), isNull(users.deletedAt), ne(users.id, input.userId)))
      .limit(1);
    if (taken) return { ok: false, reason: "taken" };

    await tx
      .update(users)
      .set({ email: newEmail, emailVerifiedAt: now, updatedAt: now })
      .where(eq(users.id, input.userId));

    // 古いアドレスに知らせる（§11。本文に新しいアドレスは書かない）
    await enqueueMail(tx, {
      associationId: null,
      mailType: "email_changed",
      toEmail: me.email,
      userId: input.userId,
    });

    // ほかの端末のセッションは終了する（§9.2）
    const endedSessions = await endUserSessions(tx, input.userId, { exceptSessionId: input.sessionId });

    return { ok: true, email: newEmail, endedSessions };
  });
}
