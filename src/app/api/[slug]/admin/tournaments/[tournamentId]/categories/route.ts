import { getDb } from "@/db/client";
import { addCategoriesFromPresets } from "@/lib/admin/categories";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// POST /api/[slug]/admin/tournaments/[tournamentId]/categories — 「よく使う部門」からまとめて追加（設計書 §5.4）
// すでに同じ部がある大会では飛ばす。コートに出る人数が参加人数の下限を超える部は 409
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "追加する部を選んでください", { field: "presetIds" });
  try {
    const result = await addCategoriesFromPresets(getDb(), gate.principal, gate.association.id, tournamentId, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
