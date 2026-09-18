import { getPrincipal } from "@/lib/auth/principal";
import { sessionCookieName } from "@/lib/auth/cookies";
import type { Principal } from "@/lib/authz";
import { InvitationError } from "@/lib/invitations/admin-accept";
import { jsonError } from "./errors";
import { isSameOrigin } from "./csrf";
import { readCookie } from "./request";

// /api/me/… の共通の入口（設計書 §10）。ログインしている人だけ。書き込みは Origin も検査する
export async function requireLoggedIn(
  request: Request,
): Promise<{ principal: Principal & { userId: string }; sessionId: string } | Response> {
  if (request.method !== "GET" && !isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const principal = await getPrincipal();
  const sessionId = readCookie(request, sessionCookieName());
  if (!principal.userId || !sessionId) return jsonError(403, "ログインが必要です");
  return { principal: { ...principal, userId: principal.userId }, sessionId };
}

export function invitationErrorResponse(error: unknown): Response {
  if (error instanceof InvitationError) return jsonError(error.status, error.message);
  throw error;
}
