import { getDb } from "@/db/client";
import { uploadDocument } from "@/lib/admin/documents";
import { jsonError } from "@/lib/api/errors";
import { formFields, readFormData } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { DOC_MAX_BYTES } from "@/lib/documents/document-input";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// POST /api/[slug]/admin/tournaments/[tournamentId]/documents — 大会資料のアップロード（設計書 §5.9）
// multipart/form-data（file・docType・title・isPublic・sortOrder）。PDF 以外と 10 MB 超は 400
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;

  const form = await readFormData(request, DOC_MAX_BYTES);
  if (form === "too_large") {
    return jsonError(400, `ファイルは ${DOC_MAX_BYTES / 1024 / 1024} MB までです。小さくしてから選んでください`, { field: "file" });
  }
  if (!form) return jsonError(400, "ファイルを選んでください", { field: "file" });
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "ファイルを選んでください", { field: "file" });

  try {
    const result = await uploadDocument(getDb(), gate.principal, gate.association.id, tournamentId, formFields(form), {
      name: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
