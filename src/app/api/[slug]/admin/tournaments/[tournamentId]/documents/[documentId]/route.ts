import { getDb } from "@/db/client";
import { editDocument, removeDocument } from "@/lib/admin/documents";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; tournamentId: string; documentId: string }> };

// PATCH — 資料の種別・タイトル・公開／非公開・並び順（設計書 §5.9）。テナント管理者だけ
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "資料のタイトルを入力してください", { field: "title" });
  try {
    await editDocument(getDb(), gate.principal, gate.association.id, tournamentId, documentId, body);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

// DELETE — 資料を削除する（論理削除）。公開用からも下ろす
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await removeDocument(getDb(), gate.principal, gate.association.id, tournamentId, documentId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
