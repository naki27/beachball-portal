import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { getLatestEntryForCopy } from "@/lib/entries/latest-entry";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// GET /api/[slug]/teams/[teamId]/entries/latest — 前回コピー用（設計書 §5.5(b)・§10）
// そのチームの直近の申込の選手と部の code を返す。生年月日は返さない（枠の値は画面の選手一覧から取る）
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    const entry = await getLatestEntryForCopy(getDb(), gate.principal, gate.association.id, teamId);
    return Response.json({ ok: true, entry }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
