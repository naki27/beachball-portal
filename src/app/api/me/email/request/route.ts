import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isSameOrigin } from "@/lib/api/csrf";
import { jsonError } from "@/lib/api/errors";
import { clientIp, readCookie, readJson } from "@/lib/api/request";
import { cookieAttributes, LOGIN_ATTEMPT_COOKIE_MAX_AGE_SECONDS, loginAttemptCookieName } from "@/lib/auth/cookies";
import { getPrincipal } from "@/lib/auth/principal";
import { requestEmailChange } from "@/lib/account/email-change";
import { getMailSender } from "@/lib/mail/sender";

// POST /api/me/email/request { email } — 新しいアドレスに確認番号を送る（設計書 §5.19・§9.2）
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const principal = await getPrincipal();
  if (!principal.userId) return jsonError(403, "ログインが必要です");

  const body = await readJson(request);
  const cookieName = loginAttemptCookieName();
  const result = await requestEmailChange(getDb(), getMailSender(), {
    userId: principal.userId,
    newEmail: typeof body?.email === "string" ? body.email : "",
    ip: clientIp(request),
    attemptId: readCookie(request, cookieName),
  });

  if (result.kind === "invalid") return jsonError(400, result.message, { field: "email" });
  if (result.kind === "rate_limited") return jsonError(429, "しばらく送れません", { retryAt: result.retryAt.toISOString() });

  const response = NextResponse.json(
    { ok: true, resendAfterSeconds: result.resendAfterSeconds },
    { headers: { "cache-control": "no-store" } },
  );
  response.cookies.set(cookieName, result.attemptId, cookieAttributes(LOGIN_ATTEMPT_COOKIE_MAX_AGE_SECONDS));
  return response;
}
