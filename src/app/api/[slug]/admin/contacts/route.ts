import { getDb } from "@/db/client";
import { getMembership } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser } from "@/lib/api/tenant";
import { setAssociationContactStatus, type ContactStatus } from "@/lib/contact-admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const membership = await getMembership(gate.principal, gate.association.id);
  const role = resolveRole(gate.principal, membership, { associationId: gate.association.id });
  const access = checkAccess(role, "manageContacts", gate.principal);
  if (!access.ok) return jsonError(403, "協会の管理者だけが問い合わせを管理できます");

  const body = await readJson(request);
  const id = typeof body?.id === "string" ? body.id : "";
  const status = body?.status;
  if (!id || (status !== "new" && status !== "done")) return jsonError(400, "問い合わせの状態を指定してください");
  const updated = await setAssociationContactStatus(getDb(), gate.association.id, id, status as ContactStatus);
  if (!updated) return jsonError(404, "問い合わせが見つかりません");
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
