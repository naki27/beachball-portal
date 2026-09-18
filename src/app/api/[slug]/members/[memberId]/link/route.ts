import { getDb } from "@/db/client";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { unlinkMember } from "@/lib/teams/self";

type Props = { params: Promise<{ slug: string; memberId: string }> };

// DELETE /api/[slug]/members/[memberId]/link — アカウントと人物の紐づけの解除（本人・テナント管理者だけ・§5.15）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, memberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await unlinkMember(getDb(), gate.principal, gate.association.id, memberId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
