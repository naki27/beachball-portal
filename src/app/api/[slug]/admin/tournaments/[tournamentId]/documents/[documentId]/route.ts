import { getDb } from "@/db/client";
import { editDocument } from "@/lib/admin/documents";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; tournamentId: string; documentId: string }> };

// PATCH /api/[slug]/admin/tournaments/[tournamentId]/documents/[documentId] — 種別・タイトル・公開／非公開・並び順（設計書 §5.9）
// テナント管理者だけ。ファイルの差し替えはアップロードし直す
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
