import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { editTeam } from "@/lib/teams/teams";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// PATCH /api/[slug]/teams/[teamId] — チーム情報の編集（§5.11）。代表者・テナント管理者だけ（それ以外は 403）
// URL の協会にそのチームがなければ 404（ほかの協会のチーム ID でも 404）
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    const team = await editTeam(getDb(), gate.principal, gate.association.id, teamId, body);
    return Response.json({ ok: true, team: { id: team.id, name: team.name } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
