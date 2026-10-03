import { getDb } from "@/db/client";
import { deleteDocument, editDocument, replaceDocumentFile } from "@/lib/admin/documents";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES_TEXT } from "@/lib/documents/document-input";

type Props = { params: Promise<{ slug: string; tournamentId: string; documentId: string }> };

// PATCH /api/[slug]/admin/tournaments/[tournamentId]/documents/[documentId] — 種別・タイトル・公開／非公開・並び順（設計書 §5.9）
// テナント管理者だけ。公開用への反映は同じトランザクションで行う
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "タイトルを入力してください", { field: "title" });
  try {
    const document = await editDocument(getDb(), gate.principal, gate.association.id, tournamentId, documentId, body);
    return Response.json({ ok: true, document: { id: document.id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

// PUT … — ファイルの差し替え（multipart の file だけ）。公開中なら公開用の URL が変わる（§5.9）
export async function PUT(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "ファイルを選んでください", { field: "file" });
  if (file.size > MAX_DOCUMENT_BYTES) return jsonError(400, `ファイルの大きさは ${MAX_DOCUMENT_BYTES_TEXT} までです`, { field: "file" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const document = await replaceDocumentFile(getDb(), gate.principal, gate.association.id, tournamentId, documentId, { contentType: file.type, bytes });
    return Response.json({ ok: true, document: { id: document.id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

// DELETE … — 論理削除（§5.16）。公開用からは同時に消える。完全に削除するのは /admin/trash から
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await deleteDocument(getDb(), gate.principal, gate.association.id, tournamentId, documentId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
