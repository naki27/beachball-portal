import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { invitePlayer } from "@/lib/teams/invitations";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// POST /api/[slug]/teams/[teamId]/invitations — 選手として招待する（代表者・§5.15）。{ memberId, email }
// 同じチームからの返事待ち・期限切れの招待があれば同じ行を再送する（resent: true）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    const result = await invitePlayer(getDb(), gate.principal, gate.association.id, teamId, body);
    return Response.json({ ok: true, ...result }, { status: result.resent ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
