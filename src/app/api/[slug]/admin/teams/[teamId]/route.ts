import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { deleteTeam } from "@/lib/admin/teams";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// DELETE /api/[slug]/admin/teams/[teamId] — チームの論理削除（テナント管理者だけ・§5.11・§5.16）。締切前の申込が残っていれば 409
// 編集・協会員の登録をするチームか・無効化は PATCH /api/[slug]/teams/[teamId]（テナント管理者も使える）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await deleteTeam(getDb(), gate.principal, gate.association.id, teamId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
