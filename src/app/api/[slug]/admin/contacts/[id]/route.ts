import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { requireTenantUser } from "@/lib/api/tenant";
import { getMembership } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { deleteAssociationContact } from "@/lib/contact-admin";

type Props = { params: Promise<{ slug: string; id: string }> };

// DELETE /api/[slug]/admin/contacts/[id] — 問い合わせの論理削除（§5.16）。復元と完全な削除は /admin/trash
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, id } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const membership = await getMembership(gate.principal, gate.association.id);
  const role = resolveRole(gate.principal, membership, { associationId: gate.association.id });
  if (!checkAccess(role, "manageContacts", gate.principal).ok) {
    return jsonError(403, "協会の管理者だけが問い合わせを管理できます");
  }
  const deleted = await deleteAssociationContact(getDb(), gate.association.id, id, gate.principal.userId);
  if (!deleted) return jsonError(404, "問い合わせが見つかりません");
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
