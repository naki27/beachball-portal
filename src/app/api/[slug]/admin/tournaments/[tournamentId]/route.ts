import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { editTournament } from "@/lib/admin/tournaments";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// PATCH /api/[slug]/admin/tournaments/[tournamentId] — 大会の編集と状態の変更（設計書 §5.4）。テナント管理者だけ
// 部門の設定値と食い違う保存（参加人数の下限 < コートの人数など）は 409（§5.4「設定値の整合性」）
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "大会名を入力してください", { field: "name" });
  try {
    const tournament = await editTournament(getDb(), gate.principal, gate.association.id, tournamentId, body);
    return Response.json({ ok: true, tournament: { id: tournament.id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
