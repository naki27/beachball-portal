import { getDb } from "@/db/client";
import { requireLoggedIn } from "@/lib/api/me";
import { listMyPendingInvitations } from "@/lib/repo/invitations";

// GET /api/me/invitations — 確認済みのメールアドレス宛ての返事待ちの招待（設計書 §10）
export async function GET(request: Request): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const invitations = await listMyPendingInvitations(getDb(), gate.principal.userId);
  return Response.json({ invitations }, { headers: { "cache-control": "no-store" } });
}
