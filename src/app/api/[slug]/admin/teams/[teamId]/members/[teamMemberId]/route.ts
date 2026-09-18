import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { deleteTeamMemberRow } from "@/lib/admin/members";

type Props = { params: Promise<{ slug: string; teamId: string; teamMemberId: string }> };

// DELETE /api/[slug]/admin/teams/[teamId]/members/[teamMemberId] — 誤登録の選手一覧の行の論理削除（テナント管理者だけ・§5.16）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId, teamMemberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await deleteTeamMemberRow(getDb(), gate.principal, gate.association.id, teamId, teamMemberId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
