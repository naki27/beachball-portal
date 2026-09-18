import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { inviteAdmin } from "@/lib/teams/admins";
import { invitePlayer } from "@/lib/teams/invitations";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// POST /api/[slug]/teams/[teamId]/invitations — 招待する（代表者・§5.15）
// 選手として: { memberId, email }。代表者として: { kind: "admin", email } か { kind: "admin", memberId }（§5.11「代表者の委譲」）
// 同じチームからの返事待ち・期限切れの招待があれば同じ行を再送する（resent: true）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    const result =
      body.kind === "admin"
        ? await inviteAdmin(getDb(), gate.principal, gate.association.id, teamId, body)
        : await invitePlayer(getDb(), gate.principal, gate.association.id, teamId, body);
    return Response.json({ ok: true, ...result }, { status: result.resent ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
