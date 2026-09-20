import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { countTrash, isTrashTable, listTrash } from "@/lib/admin/trash";

type Props = { params: Promise<{ slug: string }> };

// GET /api/[slug]/admin/trash?table= — 論理削除済みデータの一覧（テナント管理者だけ・§5.16）
// table を付けなければ、表ごとの件数だけを返す
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const table = new URL(request.url).searchParams.get("table");
  try {
    if (!table) {
      const counts = await countTrash(getDb(), gate.principal, gate.association.id);
      return Response.json({ counts }, { headers: { "cache-control": "no-store" } });
    }
    if (!isTrashTable(table)) return jsonError(404, "見つかりません");
    const items = await listTrash(getDb(), gate.principal, gate.association.id, table);
    return Response.json({ items }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
