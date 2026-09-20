import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { parseDisplayName } from "@/lib/account/display-name";
import { DELETION_BLOCK_MESSAGE, deleteMyAccount } from "@/lib/account/delete-account";
import { requireLoggedIn } from "@/lib/api/me";
import { jsonError } from "@/lib/api/errors";
import { clientIp, readCookie, readJson } from "@/lib/api/request";
import { cookieAttributes, loginAttemptCookieName, sessionCookieName } from "@/lib/auth/cookies";
import { normalizeCodeInput } from "@/lib/auth/login-input";
import { getPrincipal } from "@/lib/auth/principal";
import { updateDisplayName } from "@/lib/repo/users";

// GET /api/me — ログイン中かどうか（設計書 §10 の協会に属さない API）。メールアドレスなどは返さない
export async function GET(): Promise<Response> {
  const principal = await getPrincipal();
  return Response.json(
    {
      loggedIn: principal.sessionState === "active",
      sessionState: principal.sessionState,
      userId: principal.userId,
      isPlatformAdmin: principal.isPlatformAdmin,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

// PATCH /api/me — 表示名の変更（§5.3）。{ displayName: string | null }。空なら表示名なし
export async function PATCH(request: Request): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body || !("displayName" in body)) return jsonError(400, "表示名を入力してください");
  const parsed = parseDisplayName(body.displayName);
  if (!parsed.ok) return jsonError(400, parsed.message);
  await updateDisplayName(getDb(), gate.principal.userId, parsed.value);
  return Response.json({ ok: true, displayName: parsed.value }, { headers: { "cache-control": "no-store" } });
}

// DELETE /api/me { code } — アカウントの削除（§5.19）。いまのアドレスに送った確認番号を入れ直して確定する
// 代表者・協会の管理者・運営管理者は 409（理由と次の手順を返す）
export async function DELETE(request: Request): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? normalizeCodeInput(body.code) : null;
  const result = code
    ? await deleteMyAccount(getDb(), {
        userId: gate.principal.userId,
        attemptId: readCookie(request, loginAttemptCookieName()),
        code,
        ip: clientIp(request),
      })
    : ({ ok: false, reason: "invalid", remaining: 0 } as const);

  if (!result.ok) {
    if (result.reason === "blocked") {
      return jsonError(409, DELETION_BLOCK_MESSAGE[result.blockedBy], { code: result.blockedBy });
    }
    return jsonError(400, "番号が違います", { remaining: result.remaining });
  }

  // セッションは関数の中で消えている。Cookie も消す
  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(sessionCookieName(), "", cookieAttributes(0));
  response.cookies.set(loginAttemptCookieName(), "", cookieAttributes(0));
  return response;
}
