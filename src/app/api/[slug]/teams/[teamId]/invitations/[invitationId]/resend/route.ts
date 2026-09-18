import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { resendTeamInvitation } from "@/lib/teams/invitations";

type Props = { params: Promise<{ slug: string; teamId: string; invitationId: string }> };

// POST /api/[slug]/teams/[teamId]/invitations/[invitationId]/resend — 再送（期限が 3 日延びる・§5.15）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId, invitationId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    const result = await resendTeamInvitation(getDb(), gate.principal, gate.association.id, teamId, invitationId);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
