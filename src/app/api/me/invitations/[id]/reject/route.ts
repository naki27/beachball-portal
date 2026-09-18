import { getDb } from "@/db/client";
import { invitationErrorResponse, requireLoggedIn } from "@/lib/api/me";
import { rejectAdminInvitation } from "@/lib/invitations/admin-accept";

type Props = { params: Promise<{ id: string }> };

// POST /api/me/invitations/:id/reject — 「心当たりがない」（招待した人に知らせる）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  try {
    await rejectAdminInvitation(getDb(), gate.principal.userId, id);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return invitationErrorResponse(error);
  }
}
