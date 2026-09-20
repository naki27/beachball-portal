import { getDb } from "@/db/client";
import { confirmAgeReference } from "@/lib/admin/categories";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// POST /api/[slug]/admin/tournaments/[tournamentId]/age-reference — 「新しい基準日で確定する」（設計書 §5.4「年齢の基準日」）
// 申込に保存された年齢を、いまの基準日で数えた年齢に上書きし、entry_audits に残す。押すまでは申込時点の値のまま
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    const result = await confirmAgeReference(getDb(), gate.principal, gate.association.id, tournamentId);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
