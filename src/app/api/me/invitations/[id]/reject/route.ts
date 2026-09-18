import { getDb } from "@/db/client";
import { invitationErrorResponse, requireLoggedIn } from "@/lib/api/me";
import { respondToInvitation } from "@/lib/invitations/respond";

type Props = { params: Promise<{ id: string }> };

// POST /api/me/invitations/:id/reject — 「心当たりがない」（招待を無効にし、招待した人に知らせる・§5.14・§5.15）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  try {
    const result = await respondToInvitation(getDb(), gate.principal.userId, gate.sessionId, id, "reject");
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return invitationErrorResponse(error);
  }
}
