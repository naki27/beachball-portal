import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { isSameOrigin } from "@/lib/api/csrf";
import { jsonError } from "@/lib/api/errors";
import { clientIp, readCookie, readJson } from "@/lib/api/request";
import { cookieAttributes, loginAttemptCookieName, sessionCookieName } from "@/lib/auth/cookies";
import { normalizeCodeInput } from "@/lib/auth/login-input";
import { getPrincipal } from "@/lib/auth/principal";
import { confirmEmailChange } from "@/lib/account/email-change";

// POST /api/me/email/verify { code } — 確認番号でメールアドレスの変更を確定する（設計書 §5.19）
// 確定すると、この端末以外のセッションは終了する。古いアドレスに知らせが届く
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const principal = await getPrincipal();
  if (!principal.userId) return jsonError(403, "ログインが必要です");

  const body = await readJson(request);
  const code = typeof body?.code === "string" ? normalizeCodeInput(body.code) : null;
  const sessionId = readCookie(request, sessionCookieName()) ?? "";
  const result = code
    ? await confirmEmailChange(getDb(), {
        userId: principal.userId,
        attemptId: readCookie(request, loginAttemptCookieName()),
        code,
        ip: clientIp(request),
        sessionId,
      })
    : ({ ok: false, reason: "invalid", remaining: 0 } as const);

  if (!result.ok) {
    if (result.reason === "taken") {
      return jsonError(409, "このメールアドレスは別のアカウントで使われています", { code: "email_taken" });
    }
    return jsonError(400, "番号が違います", { remaining: result.remaining });
  }

  const response = NextResponse.json({ ok: true, email: result.email }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(loginAttemptCookieName(), "", cookieAttributes(0));
  return response;
}
