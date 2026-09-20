import { getDb } from "@/db/client";
import { openRenewalPeriod } from "@/lib/admin/memberships";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string }> };

// POST /api/[slug]/admin/memberships — 年度更新の受付を始める（設計書 §5.12「受付開始」）。テナント管理者だけ
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "年度を 4 けたの数で入力してください", { field: "year" });
  try {
    const result = await openRenewalPeriod(getDb(), gate.principal, gate.association.id, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
