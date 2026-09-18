import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { platformErrorResponse, requirePlatformAdmin } from "@/lib/api/platform";
import { readCookie } from "@/lib/api/request";
import { sessionCookieName } from "@/lib/auth/cookies";
import { enterTenant, leaveTenant } from "@/lib/platform/associations";

type Props = { params: Promise<{ id: string }> };

// POST /api/platform/associations/:id/enter — 協会に切り替えて入る（1 時間・記録・§5.14）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const sessionId = readCookie(request, sessionCookieName());
  if (!sessionId) return jsonError(403, "ログインが必要です");
  const { id } = await params;
  try {
    const until = await enterTenant(getDb(), gate.principal.userId, sessionId, id);
    return Response.json({ ok: true, enteredUntil: until.toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformErrorResponse(error);
  }
}

// DELETE /api/platform/associations/:id/enter — 出る（即座に解除）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const sessionId = readCookie(request, sessionCookieName());
  if (!sessionId) return jsonError(403, "ログインが必要です");
  const { id } = await params;
  await leaveTenant(getDb(), gate.principal.userId, sessionId, id);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
