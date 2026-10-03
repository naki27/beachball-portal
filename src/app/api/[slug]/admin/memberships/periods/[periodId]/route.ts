import { getDb } from "@/db/client";
import { editMembershipPeriod } from "@/lib/admin/membership-periods";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; periodId: string }> };

// PATCH /api/[slug]/admin/memberships/periods/[periodId] — 受付期間・承認の設定を直す（設計書 §5.12）。年度は変えられない
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, periodId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "受付の開始日を入力してください", { field: "opensDate" });
  try {
    const period = await editMembershipPeriod(getDb(), gate.principal, gate.association.id, periodId, body);
    return Response.json({ ok: true, period: { id: period.id, year: period.year } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
