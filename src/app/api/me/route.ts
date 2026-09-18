import { getDb } from "@/db/client";
import { parseDisplayName } from "@/lib/account/display-name";
import { requireLoggedIn } from "@/lib/api/me";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
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
