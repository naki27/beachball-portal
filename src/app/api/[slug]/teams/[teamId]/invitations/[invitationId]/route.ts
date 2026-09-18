import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { cancelTeamInvitation } from "@/lib/teams/invitations";

type Props = { params: Promise<{ slug: string; teamId: string; invitationId: string }> };

// DELETE /api/[slug]/teams/[teamId]/invitations/[invitationId] — 招待の取り消し（代表者・§5.15）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId, invitationId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await cancelTeamInvitation(getDb(), gate.principal, gate.association.id, teamId, invitationId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
