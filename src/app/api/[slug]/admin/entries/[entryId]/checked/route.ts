import { getDb } from "@/db/client";
import { markEntryChecked } from "@/lib/admin/entries";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; entryId: string }> };

// POST /api/[slug]/admin/entries/[entryId]/checked — 「運営の確認対象」の印を外す（設計書 §5.5・§10）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, entryId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await markEntryChecked(getDb(), gate.principal, gate.association.id, entryId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
