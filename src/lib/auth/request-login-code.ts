import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginCodes, mailLogs } from "@/db/schema";
import { requireEnv } from "@/db/env";
import { composeLoginCodeMail } from "@/lib/mail/templates";
import type { MailSender } from "@/lib/mail/types";
import {
  generateAttemptId,
  generateCode,
  hashAttemptId,
  hashCode,
  hashEmailForKey,
  loginCodeTtlMinutes,
} from "./login-code";
import { consumeRateLimits, HOUR_MS } from "./rate-limit";

// 確認番号の発行（設計書 §5.1・§9.1・§9.2・§11「送り方」）
// - 登録済みかどうかは見ない（users を作らない・読まない）ので、文言も所要時間も同じになる
// - 番号は DB に残さない（HMAC だけ）。メールは応答を返す前に送り、mail_logs に sent / failed を記録する（番号は書かない）
// - 再送は同じ試行 ID で発行する（それまでの未期限の番号は無効にしない・§9.2）

// レート制限の上限（§9.2【仮】）
export const REQUEST_LIMITS = {
  perEmailPerHour: 5,
  perIpPerHour: 20,
  totalPerHour: 150,
} as const;

// 「もう一度送る」までの待ち時間（§4.5 ログイン【仮】）。同じ試行で何回目の発行かで延ばす
export const RESEND_WAIT_SECONDS = [30, 60, 120] as const;

export type RequestLoginCodeInput = {
  // normalizeEmail 済み
  email: string;
  ip: string;
  // 再送のとき、Cookie にある試行 ID。なければ新しく作る
  attemptId?: string | null;
  // 協会のページから来た場合の協会名（件名に使う）。なければサイト名
  associationName: string | null;
  purpose?: "login";
  now?: Date;
};

export type RequestLoginCodeResult =
  | { kind: "sent"; attemptId: string; resendAfterSeconds: number }
  | { kind: "rate_limited"; retryAt: Date };

export async function requestLoginCode(
  db: Db,
  sender: MailSender,
  input: RequestLoginCodeInput,
): Promise<RequestLoginCodeResult> {
  const now = input.now ?? new Date();
  const hmacKey = requireEnv("LOGIN_CODE_HMAC_KEY");
  const ttlMinutes = loginCodeTtlMinutes();

  const limited = await consumeRateLimits(
    db,
    [
      { key: `login_request:email:${hashEmailForKey(input.email)}`, limit: REQUEST_LIMITS.perEmailPerHour, windowMs: HOUR_MS },
      { key: `login_request:ip:${input.ip}`, limit: REQUEST_LIMITS.perIpPerHour, windowMs: HOUR_MS },
      { key: "login_request:all", limit: REQUEST_LIMITS.totalPerHour, windowMs: HOUR_MS },
    ],
    now,
  );
  if (!limited.allowed) return { kind: "rate_limited", retryAt: limited.retryAt };

  const attemptId = input.attemptId || generateAttemptId();
  const attemptHash = hashAttemptId(attemptId);
  const code = generateCode();

  await db.insert(loginCodes).values({
    purpose: "login",
    email: input.email,
    attemptHash,
    codeHash: hashCode(hmacKey, attemptId, code),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
  });

  // この試行で何回目の発行か（未期限のものだけ数える）→ 次の「もう一度送る」までの待ち時間
  const issued = await db
    .select({ id: loginCodes.id })
    .from(loginCodes)
    .where(and(eq(loginCodes.attemptHash, attemptHash), gt(loginCodes.expiresAt, now)));
  const resendAfterSeconds = RESEND_WAIT_SECONDS[Math.min(issued.length, RESEND_WAIT_SECONDS.length) - 1];

  // 応答の前に送る。失敗しても応答は同じ（利用者は「もう一度送る」で送り直す）
  const mail = composeLoginCodeMail({ code, ttlMinutes, associationName: input.associationName, purpose: "login" });
  let status: "sent" | "failed" = "sent";
  let providerMessageId: string | null = null;
  let error: string | null = null;
  try {
    providerMessageId = (await sender.send({ to: input.email, ...mail })).providerMessageId ?? null;
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? e.name : "send failed";
  }
  await db.insert(mailLogs).values({
    id: crypto.randomUUID(),
    associationId: null,
    mailType: "login_code",
    toEmail: input.email,
    params: {},
    status,
    attempts: 1,
    sentAt: status === "sent" ? now : null,
    providerMessageId,
    error,
  });

  return { kind: "sent", attemptId, resendAfterSeconds };
}
