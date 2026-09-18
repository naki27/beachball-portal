import { getDb } from "@/db/client";
import { invitationErrorResponse, requireLoggedIn } from "@/lib/api/me";
import { acceptAdminInvitation } from "@/lib/invitations/admin-accept";

type Props = { params: Promise<{ id: string }> };

// POST /api/me/invitations/:id/accept — 招待を承諾する（テナント管理者。選手・代表者の招待は A-19）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  try {
    const result = await acceptAdminInvitation(getDb(), gate.principal.userId, gate.sessionId, id);
    return Response.json(
      { ok: true, redirectTo: `/${result.associationSlug}/admin`, associationName: result.associationName },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return invitationErrorResponse(error);
  }
}
