import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { isTrashTable, restoreFromTrash } from "@/lib/admin/trash";

type Props = { params: Promise<{ slug: string; table: string; id: string }> };

// POST /api/[slug]/admin/trash/[table]/[id]/restore — 復元（テナント管理者だけ・§5.16）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, table, id } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  if (!isTrashTable(table)) return jsonError(404, "見つかりません");
  try {
    await restoreFromTrash(getDb(), gate.principal, gate.association.id, table, id);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
