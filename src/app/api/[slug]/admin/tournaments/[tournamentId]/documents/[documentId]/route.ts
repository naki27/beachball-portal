import { getDb } from "@/db/client";
import { editDocument, removeDocument, replaceDocumentFile } from "@/lib/admin/documents";
import { jsonError } from "@/lib/api/errors";
import { readFormData, readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { DOC_MAX_BYTES } from "@/lib/documents/document-input";

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

// PUT — ファイルの差し替え（設計書 §5.9）。公開中なら新しい名前で置き直すので、公開用の URL が変わる
export async function PUT(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;

  const form = await readFormData(request, DOC_MAX_BYTES);
  if (form === "too_large") {
    return jsonError(400, `ファイルは ${DOC_MAX_BYTES / 1024 / 1024} MB までです。小さくしてから選んでください`, { field: "file" });
  }
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "差し替えるファイルを選んでください", { field: "file" });

  try {
    await replaceDocumentFile(getDb(), gate.principal, gate.association.id, tournamentId, documentId, {
      name: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
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
