import { getDb } from "@/db/client";
import { editCategory, removeCategory } from "@/lib/admin/categories";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; tournamentId: string; categoryId: string }> };

// PATCH — 部の表示名・締切・基準日・申し込みの上限の上書き（設計書 §5.4）。テナント管理者だけ
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, categoryId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "部の名前を入力してください", { field: "label" });
  try {
    await editCategory(getDb(), gate.principal, gate.association.id, tournamentId, categoryId, body);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

// DELETE — 部を大会から外す（論理削除）。申し込みが 1 件でもあれば 409（§5.4 受け入れ条件）
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, categoryId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await removeCategory(getDb(), gate.principal, gate.association.id, tournamentId, categoryId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
