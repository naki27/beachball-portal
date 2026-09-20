import { getDb } from "@/db/client";
import { deleteEntryByAdmin } from "@/lib/admin/entries";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; entryId: string }> };

// DELETE /api/[slug]/admin/entries/[entryId] — 申込の論理削除（誤登録の取り消し・設計書 §5.16）
// 代表者の「取消」（status = cancelled）とは別物。完全に削除するのは /admin/trash から
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, entryId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await deleteEntryByAdmin(getDb(), gate.principal, gate.association.id, entryId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
