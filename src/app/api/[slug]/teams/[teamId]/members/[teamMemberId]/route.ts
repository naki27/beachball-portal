import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { updatePlayer } from "@/lib/teams/roster";

type Props = { params: Promise<{ slug: string; teamId: string; teamMemberId: string }> };

// PATCH /api/[slug]/teams/[teamId]/members/[teamMemberId] — 選手の情報の修正（代表者・§5.11）
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId, teamMemberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    await updatePlayer(getDb(), gate.principal, gate.association.id, teamId, teamMemberId, body);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
