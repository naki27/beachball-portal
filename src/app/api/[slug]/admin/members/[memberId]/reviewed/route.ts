import { getDb } from "@/db/client";
import { resolveAsDifferentPerson } from "@/lib/admin/merge-members";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; memberId: string }> };

// POST /api/[slug]/admin/members/[memberId]/reviewed — 要確認の解消（「別の人です」・設計書 §5.8・§10）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, memberId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await resolveAsDifferentPerson(getDb(), gate.principal, gate.association.id, memberId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
