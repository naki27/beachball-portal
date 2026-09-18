import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { undoLeave } from "@/lib/teams/roster";

type Props = { params: Promise<{ slug: string; teamId: string; teamMemberId: string }> };

// POST /api/[slug]/teams/[teamId]/members/[teamMemberId]/undo-leave — 外したのを元に戻す（外した本人・30 分以内・§5.11）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId, teamMemberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await undoLeave(getDb(), gate.principal, gate.association.id, teamId, teamMemberId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
