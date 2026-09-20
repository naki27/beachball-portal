import { getDb } from "@/db/client";
import { resolveAssociationForApi } from "@/lib/api/resolve";
import { teamErrorResponse } from "@/lib/api/tenant";
import { getEntryTeamsForPublic } from "@/lib/public/tournaments";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// GET /api/[slug]/tournaments/[tournamentId]/entries — 参加チーム一覧（§10・§5.6）
// **部とチーム名とチーム数だけ**。誰が見ても選手の氏名・生年月日・性別・連絡先は含めない（フロントで隠すだけにしない）
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const resolved = await resolveAssociationForApi(slug, request);
  if (resolved instanceof Response) return resolved;
  try {
    const { tournament, groups } = await getEntryTeamsForPublic(getDb(), resolved.association.id, tournamentId);
    return Response.json(
      { ok: true, tournament: { id: tournament.id, name: tournament.name, teams: tournament.teams }, groups },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return teamErrorResponse(error);
  }
}
