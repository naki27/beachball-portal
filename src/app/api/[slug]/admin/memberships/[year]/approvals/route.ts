import { getDb } from "@/db/client";
import { approveDeclarations } from "@/lib/admin/memberships";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; year: string }> };

// POST — 年度更新の申告を承認する（設計書 §5.12）。テナント管理者だけ。追加の申告も同じ入口
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, year } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear)) return jsonError(404, "その年度の受付が見つかりません");
  const body = await readJson(request);
  if (!body) return jsonError(400, "承認する人を選んでください", { field: "memberIds" });
  try {
    const result = await approveDeclarations(getDb(), gate.principal, gate.association.id, parsedYear, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
