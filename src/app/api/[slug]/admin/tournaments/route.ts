import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { createTournament } from "@/lib/admin/tournaments";

type Props = { params: Promise<{ slug: string }> };

// POST /api/[slug]/admin/tournaments — 大会を作る（設計書 §5.4・§10）。テナント管理者だけ（manageTournaments）
// 日付は "YYYY-MM-DD" で受け、申し込みの開始はその日の 0:00、締切はその日の 23:59:59（日本時間）で保存する
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "大会名を入力してください", { field: "name" });
  try {
    const tournament = await createTournament(getDb(), gate.principal, gate.association.id, body);
    return Response.json(
      { ok: true, tournament: { id: tournament.id }, redirectTo: `/${gate.association.slug}/admin/tournaments/${tournament.id}?created=1` },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return teamErrorResponse(error);
  }
}
