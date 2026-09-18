import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { addPlayer, getRoster } from "@/lib/teams/roster";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// GET /api/[slug]/teams/[teamId]/members — 選手一覧（選手・代表者）。選手にはほかの人の生年月日・年齢・性別を返さない（§3.2）
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    const roster = await getRoster(getDb(), gate.principal, gate.association.id, teamId);
    return Response.json(roster, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

// POST /api/[slug]/teams/[teamId]/members — 選手の追加（代表者）。本人の情報を入力し、保存時に名寄せ（§5.11・§8.3）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    const result = await addPlayer(getDb(), gate.principal, gate.association.id, teamId, body);
    return Response.json({ ok: true, ...result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
