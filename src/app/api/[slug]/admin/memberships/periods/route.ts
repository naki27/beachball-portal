import { getDb } from "@/db/client";
import { openMembershipPeriod } from "@/lib/admin/membership-periods";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string }> };

// POST /api/[slug]/admin/memberships/periods — 年度更新の受付を開始する（設計書 §5.12「受付開始」）。テナント管理者だけ
// { year, opensDate, closesDate, autoApprove }。同じ年度の受付があれば 409
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "対象年度を西暦の 4 けたで入力してください", { field: "year" });
  try {
    const period = await openMembershipPeriod(getDb(), gate.principal, gate.association.id, body);
    return Response.json({ ok: true, period: { id: period.id, year: period.year } }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
