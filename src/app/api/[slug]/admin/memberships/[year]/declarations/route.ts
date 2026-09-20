import { getDb } from "@/db/client";
import { declareForTeamAsAdmin } from "@/lib/admin/memberships";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; year: string }> };

// POST — 運営が代理で申告・修正する（設計書 §5.12）。締切後も直せる。テナント管理者だけ
// 年度は URL の年度ではなく「いまの年度」で処理する（過去の年度の書き換えは作らない）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, year } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  if (!Number.isInteger(Number(year))) return jsonError(404, "その年度の受付が見つかりません");
  const body = await readJson(request);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  if (!body || !teamId) return jsonError(400, "チームを選んでください", { field: "teamId" });
  try {
    const result = await declareForTeamAsAdmin(getDb(), gate.principal, gate.association.id, teamId, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
