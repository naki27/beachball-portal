import { getDb } from "@/db/client";
import { resolveAssociationForApi } from "@/lib/api/resolve";
import { teamErrorResponse } from "@/lib/api/tenant";
import { getTournamentForPublic } from "@/lib/public/tournaments";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// GET /api/[slug]/tournaments/[tournamentId] — 大会詳細（部を含む・§10・§5.6）。準備中の大会は 404
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const resolved = await resolveAssociationForApi(slug, request);
  if (resolved instanceof Response) return resolved;
  try {
    const tournament = await getTournamentForPublic(getDb(), resolved.association.id, tournamentId);
    return Response.json({ ok: true, tournament }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
