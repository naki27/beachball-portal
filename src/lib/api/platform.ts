import { getPrincipal } from "@/lib/auth/principal";
import { isPlatformAdmin, type Principal } from "@/lib/authz";
import { PlatformError } from "@/lib/platform/associations";
import { jsonError } from "./errors";
import { isSameOrigin } from "./csrf";

// /api/platform/… の共通の入口（設計書 §10）。運営管理者だけ。書き込みは Origin も検査する
export async function requirePlatformAdmin(request: Request): Promise<{ principal: Principal & { userId: string } } | Response> {
  if (request.method !== "GET" && !isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const principal = await getPrincipal();
  if (!principal.userId) return jsonError(403, "ログインが必要です");
  if (!isPlatformAdmin(principal)) return jsonError(403, "運営管理者だけが使えます");
  return { principal: { ...principal, userId: principal.userId } };
}

// PlatformError（400 / 409）を JSON の応答にする。それ以外はそのまま投げる
export function platformErrorResponse(error: unknown): Response {
  if (error instanceof PlatformError) return jsonError(error.status, error.message, error.field ? { field: error.field } : {});
  throw error;
}
