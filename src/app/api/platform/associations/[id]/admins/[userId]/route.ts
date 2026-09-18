import { getDb } from "@/db/client";
import { platformErrorResponse, requirePlatformAdmin } from "@/lib/api/platform";
import { removeAssociationAdmin } from "@/lib/platform/admin-invitations";

type Props = { params: Promise<{ id: string; userId: string }> };

// DELETE /api/platform/associations/:id/admins/:userId — テナント管理者の解除（設計書 §10・§5.14）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const { id, userId } = await params;
  try {
    await removeAssociationAdmin(getDb(), gate.principal.userId, id, userId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return platformErrorResponse(error);
  }
}
