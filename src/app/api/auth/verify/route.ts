import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { isSameOrigin } from "@/lib/api/csrf";
import { clientIp, readJson } from "@/lib/api/request";
import {
  cookieAttributes,
  loginAttemptCookieName,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  sessionCookieName,
} from "@/lib/auth/cookies";
import { normalizeCodeInput } from "@/lib/auth/login-input";
import { redirectAfterLogin } from "@/lib/auth/redirect-after-login";
import { verifyLoginCode } from "@/lib/auth/verify-login-code";
import { readCookie } from "@/lib/api/request";

// POST /api/auth/verify { code, next? } — 確認番号を照合してログインする（設計書 §9.1・§9.2）
// 失敗はどの理由でも同じ形（400・「番号が違います」・remaining）。成功でセッションの Cookie を返し、試行の Cookie を消す
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? normalizeCodeInput(body.code) : null;
  const next = typeof body?.next === "string" ? body.next : null;
  const attemptId = readCookie(request, loginAttemptCookieName());
  const db = getDb();

  const result = code
    ? await verifyLoginCode(db, {
        attemptId,
        code,
        ip: clientIp(request),
        termsVersion: process.env.TERMS_VERSION ?? "",
      })
    : ({ ok: false, reason: "invalid", remaining: 0 } as const);

  if (!result.ok) {
    if (result.reason === "admin_session_exists") {
      // テナント管理者は同時に 1 つまで（§9.2）。番号はそのまま使えるので、もう一方でログアウトしてから同じ番号で入れる
      return Response.json(
        {
          error: {
            status: 409,
            code: "admin_session_exists",
            message: "別の端末（またはアプリ）でログインしています。そちらでログアウトしてから、もう一度お試しください",
          },
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      { error: { status: 400, message: "番号が違います", remaining: result.remaining } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const redirectTo = await redirectAfterLogin(db, result.userId, next);
  const response = NextResponse.json({ ok: true, redirectTo }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(sessionCookieName(), result.session.id, cookieAttributes(SESSION_COOKIE_MAX_AGE_SECONDS));
  response.cookies.set(loginAttemptCookieName(), "", cookieAttributes(0));
  return response;
}
