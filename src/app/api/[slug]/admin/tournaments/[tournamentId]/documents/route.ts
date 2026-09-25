import { getDb } from "@/db/client";
import { uploadDocument } from "@/lib/admin/documents";
import { jsonError } from "@/lib/api/errors";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES_TEXT } from "@/lib/documents/document-input";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// POST /api/[slug]/admin/tournaments/[tournamentId]/documents — 大会資料のアップロード（設計書 §5.9）。テナント管理者だけ
// multipart/form-data（file・docType・title・isPublic・sortOrder）。アプリが大きさ・Content-Type・先頭の %PDF- を確かめてから保管用に置く
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File) || file.size === 0) return jsonError(400, "ファイルを選んでください", { field: "file" });
  if (file.size > MAX_DOCUMENT_BYTES) return jsonError(400, `ファイルの大きさは ${MAX_DOCUMENT_BYTES_TEXT} までです`, { field: "file" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const document = await uploadDocument(
      getDb(),
      gate.principal,
      gate.association.id,
      tournamentId,
      { contentType: file.type, bytes },
      { docType: form.get("docType"), title: form.get("title"), isPublic: form.get("isPublic"), sortOrder: form.get("sortOrder") ?? undefined },
    );
    return Response.json({ ok: true, document: { id: document.id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
