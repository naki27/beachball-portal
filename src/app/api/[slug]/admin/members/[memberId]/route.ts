import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { updateMemberByAdmin } from "@/lib/admin/members";

type Props = { params: Promise<{ slug: string; memberId: string }> };

// PATCH /api/[slug]/admin/members/[memberId] — 人物の情報の修正（テナント管理者だけ・§4.2 #15）
// 紐づけの解除は DELETE /api/[slug]/members/[memberId]/link（本人・テナント管理者）
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, memberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    await updateMemberByAdmin(getDb(), gate.principal, gate.association.id, memberId, body);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
