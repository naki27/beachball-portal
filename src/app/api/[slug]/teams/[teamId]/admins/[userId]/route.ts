import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { revokeTeamAdmin } from "@/lib/teams/admins";

type Props = { params: Promise<{ slug: string; teamId: string; userId: string }> };

// DELETE /api/[slug]/teams/[teamId]/admins/[userId] — 代表者の解除（代表者・テナント管理者。最後の 1 人は 409・§5.11）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId, userId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await revokeTeamAdmin(getDb(), gate.principal, gate.association.id, teamId, userId);
    return Response.json({ ok: true, self: userId === gate.principal.userId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
