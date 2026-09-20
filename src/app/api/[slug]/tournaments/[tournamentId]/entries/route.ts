import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { resolveAssociationForApi } from "@/lib/api/resolve";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { submitEntry } from "@/lib/entries/submit-entry";
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

// POST /api/[slug]/tournaments/[tournamentId]/entries — 申込の作成（§10・§5.5(c)）
// 送信時にサーバーが「選んだチームの有効な代表者か」を検査する（403）。締切後・定員は 409、入力の誤りは 400
// 同じワンタイムの値での再送は 2 件目を作らず、1 件目を返す（already = true）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    const result = await submitEntry(getDb(), gate.principal, gate.association.id, tournamentId, body);
    return Response.json(
      {
        ok: true,
        entryId: result.entryId,
        already: result.alreadySubmitted,
        warnings: result.warnings,
        redirectTo: `/${gate.association.slug}/entries/${result.entryId}?done=1`,
      },
      { status: result.alreadySubmitted ? 200 : 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return teamErrorResponse(error);
  }
}
