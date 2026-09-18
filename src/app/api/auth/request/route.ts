import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { isSameOrigin } from "@/lib/api/csrf";
import { clientIp, readCookie, readJson } from "@/lib/api/request";
import { cookieAttributes, LOGIN_ATTEMPT_COOKIE_MAX_AGE_SECONDS, loginAttemptCookieName } from "@/lib/auth/cookies";
import { normalizeEmail } from "@/lib/auth/login-input";
import { requestLoginCode } from "@/lib/auth/request-login-code";
import { getMailSender } from "@/lib/mail/sender";
import { resolveAssociation } from "@/lib/resolve-association";
import { slugFromUrl } from "@/lib/slug";

// POST /api/auth/request { email, next? } — 確認番号を発行して送る（設計書 §9.1）
// 応答は登録済みかどうかによらず同じ。試行 ID を HttpOnly の Cookie で返す（再送は同じ試行）
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const body = await readJson(request);
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) {
    return Response.json(
      { error: { status: 400, message: "メールアドレスの形で入力してください", field: "email" } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  // 協会のページから来た場合は、件名にその協会名（next の先頭のスラッグから）
  const next = typeof body?.next === "string" ? body.next : "";
  const slug = next.startsWith("/") ? slugFromUrl(next) : null;
  const association = slug ? await resolveAssociation(slug) : null;
  const associationName = association && association.kind !== "not_found" ? association.association.name : null;

  const cookieName = loginAttemptCookieName();
  const existingAttempt = readCookie(request, cookieName);

  const result = await requestLoginCode(getDb(), getMailSender(), {
    email,
    ip: clientIp(request),
    attemptId: existingAttempt,
    associationName,
  });

  if (result.kind === "rate_limited") {
    return Response.json(
      { error: { status: 429, message: "しばらく送れません", retryAt: result.retryAt.toISOString() } },
      { status: 429, headers: { "cache-control": "no-store" } },
    );
  }

  const response = NextResponse.json(
    { ok: true, resendAfterSeconds: result.resendAfterSeconds },
    { headers: { "cache-control": "no-store" } },
  );
  response.cookies.set(cookieName, result.attemptId, cookieAttributes(LOGIN_ATTEMPT_COOKIE_MAX_AGE_SECONDS));
  return response;
}
