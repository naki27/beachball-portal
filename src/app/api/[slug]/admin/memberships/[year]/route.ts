import { getDb } from "@/db/client";
import { editRenewalPeriod } from "@/lib/admin/memberships";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; year: string }> };

// PATCH — 受付の期間・承認を省くかを直す（設計書 §5.12）。テナント管理者だけ
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, year } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const parsedYear = Number(year);
  if (!Number.isInteger(parsedYear)) return jsonError(404, "その年度の受付が見つかりません");
  const body = await readJson(request);
  if (!body) return jsonError(400, "受付の開始日を年月日で入力してください", { field: "opensDate" });
  try {
    await editRenewalPeriod(getDb(), gate.principal, gate.association.id, parsedYear, body);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
