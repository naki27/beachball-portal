import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { leavePlayer } from "@/lib/teams/roster";

type Props = { params: Promise<{ slug: string; teamId: string; teamMemberId: string }> };

// POST /api/[slug]/teams/[teamId]/members/[teamMemberId]/leave — 選手一覧から外す（代表者・§5.11）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId, teamMemberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    const result = await leavePlayer(getDb(), gate.principal, gate.association.id, teamId, teamMemberId);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
