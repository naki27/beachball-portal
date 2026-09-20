import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { isPurgeReasonKind, isTrashTable, purgeFromTrash } from "@/lib/admin/trash";

type Props = { params: Promise<{ slug: string; table: string; id: string }> };

// DELETE /api/[slug]/admin/trash/[table]/[id] { reason, reason_kind } — 物理削除（テナント管理者だけ・§5.16）
// 論理削除済みのものだけ。deletion_logs に記録を残す（中身は残さない）
// reason_kind は人物を消すときの申込の記録の扱いを決める（保存期間の満了なら氏名を残す・§5.16）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, table, id } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  if (!isTrashTable(table)) return jsonError(404, "見つかりません");
  const body = await readJson(request);
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const reasonKind = isPurgeReasonKind(body?.reason_kind) ? body.reason_kind : "other";
  try {
    const result = await purgeFromTrash(getDb(), gate.principal, gate.association.id, table, id, reason, reasonKind);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
