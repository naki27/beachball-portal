import { getDb } from "@/db/client";
import { invitationErrorResponse, requireLoggedIn } from "@/lib/api/me";
import { respondToInvitation } from "@/lib/invitations/respond";

type Props = { params: Promise<{ id: string }> };

// POST /api/me/invitations/:id/accept — 招待を承諾する（テナント管理者・選手・代表者。種別で振り分け・§5.14・§5.15）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  try {
    const result = await respondToInvitation(getDb(), gate.principal.userId, gate.sessionId, id, "accept");
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return invitationErrorResponse(error);
  }
}
