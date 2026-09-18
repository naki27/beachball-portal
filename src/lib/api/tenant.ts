import { getPrincipal } from "@/lib/auth/principal";
import type { Principal } from "@/lib/authz";
import type { Association } from "@/lib/repo/associations";
import { TeamError } from "@/lib/teams/teams";
import { isSameOrigin } from "./csrf";
import { jsonError } from "./errors";
import { resolveAssociationForApi } from "./resolve";

// /api/[slug]/… のうち、ログインしている人だけが使う API の共通の入口（設計書 §10・§3.1）
// 書き込みは Origin を検査 → 協会の解決（なければ 404・旧スラッグは 308）→ 未ログインは 403
export async function requireTenantUser(
  request: Request,
  slug: string,
): Promise<{ association: Association; principal: Principal & { userId: string } } | Response> {
  if (request.method !== "GET" && !isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const resolved = await resolveAssociationForApi(slug, request);
  if (resolved instanceof Response) return resolved;
  const principal = await getPrincipal();
  if (!principal.userId) return jsonError(403, "ログインが必要です");
  return { association: resolved.association, principal: { ...principal, userId: principal.userId } };
}

// TeamError（400 / 403 / 404 / 409）を JSON の応答にする。それ以外はそのまま投げる
export function teamErrorResponse(error: unknown): Response {
  if (error instanceof TeamError) return jsonError(error.status, error.message, error.extra);
  throw error;
}
