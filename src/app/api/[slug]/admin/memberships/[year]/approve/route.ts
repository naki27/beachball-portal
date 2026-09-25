import { getDb } from "@/db/client";
import { approveMemberships } from "@/lib/admin/membership-approval";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; year: string }> };

// POST /api/[slug]/admin/memberships/[year]/approve — 申告の一括承認（設計書 §5.12・§4.2 #17）。テナント管理者だけ
// { scope: "renewal" | "additional", teamIds?: string[] }。承認したチームの代表者に membership_approved を送る
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, year } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  if (!/^\d{4}$/.test(year)) return jsonError(404, "受付が見つかりません");
  const body = await readJson(request);
  if (!body) return jsonError(400, "承認する対象を選んでください");
  try {
    const result = await approveMemberships(getDb(), gate.principal, gate.association.id, Number(year), body);
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
