import { getDb } from "@/db/client";
import { resolveAssociationForApi } from "@/lib/api/resolve";
import { findPublicDocumentUrl } from "@/lib/public/tournaments";
import { getStorage } from "@/lib/storage";

type Props = { params: Promise<{ slug: string; tournamentId: string; documentId: string }> };

// GET /[スラッグ]/tournaments/[id]/documents/[docId] — 大会資料を開く（設計書 §5.9「配信の仕組み」）
// **利用者が共有するのはこの URL**（期限なし）。公開中なら公開用の URL へ 302 で送る。
// 非公開・削除済み・大会が draft のときは 404（署名 URL は使わない・v0.9.1）
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const resolved = await resolveAssociationForApi(slug, request);
  if (resolved instanceof Response) return resolved;

  const url = await findPublicDocumentUrl(getDb(), resolved.association.id, tournamentId, documentId, getStorage());
  if (!url) {
    return new Response("この資料は見つかりませんでした。大会のページから開き直してください。", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // 公開用の URL は期限なし。キャッシュは Cloudflare 側（§5.9）。転送そのものはキャッシュさせない
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
}
