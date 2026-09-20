import { getDb } from "@/db/client";
import { mergeMembers } from "@/lib/admin/merge-members";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; memberId: string }> };

// POST /api/[slug]/admin/members/[memberId]/merge — 2 つの人物をまとめる（設計書 §5.8・§10）
// [memberId] が消える側、`into_member_id` が残す側。両方が別のアカウントに紐づいていれば 409
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, memberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  const into = typeof body.into_member_id === "string" ? body.into_member_id : "";
  try {
    await mergeMembers(getDb(), gate.principal, gate.association.id, into, memberId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
