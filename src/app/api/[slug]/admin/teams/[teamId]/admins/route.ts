import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { assignTeamAdmin } from "@/lib/admin/teams";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// POST /api/[slug]/admin/teams/[teamId]/admins — 代表者の付け替え（追加）。{ email }。テナント管理者だけ、承諾なし（docs/adr/0015）
// 解除は DELETE /api/[slug]/teams/[teamId]/admins/[userId]（テナント管理者も使える。最後の 1 人は 409）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    const result = await assignTeamAdmin(getDb(), gate.principal, gate.association.id, teamId, body.email);
    return Response.json({ ok: true, ...result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
