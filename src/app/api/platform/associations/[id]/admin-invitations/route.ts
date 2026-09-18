import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { platformErrorResponse, requirePlatformAdmin } from "@/lib/api/platform";
import { readJson } from "@/lib/api/request";
import { cancelAdminInvitation, inviteAssociationAdmin, resendAdminInvitation } from "@/lib/platform/admin-invitations";

type Props = { params: Promise<{ id: string }> };

// POST /api/platform/associations/:id/admin-invitations — 招待（{ email }）または再送（{ invitationId }）（設計書 §10・§5.14）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const body = await readJson(request);
  try {
    if (typeof body?.invitationId === "string") {
      await resendAdminInvitation(getDb(), gate.principal.userId, id, body.invitationId);
      return Response.json({ ok: true, resent: true }, { headers: { "cache-control": "no-store" } });
    }
    const result = await inviteAssociationAdmin(getDb(), gate.principal.userId, id, typeof body?.email === "string" ? body.email : "");
    return Response.json({ ok: true, ...result }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformErrorResponse(error);
  }
}

// DELETE /api/platform/associations/:id/admin-invitations — 取り消し（{ invitationId }）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const body = await readJson(request);
  if (typeof body?.invitationId !== "string") return jsonError(400, "取り消す招待を指定してください");
  try {
    await cancelAdminInvitation(getDb(), gate.principal.userId, id, body.invitationId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformErrorResponse(error);
  }
}
