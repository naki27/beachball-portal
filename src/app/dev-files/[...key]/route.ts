import { getStorage } from "@/lib/storage";
import { assertStorageKey } from "@/lib/storage/types";

type Props = { params: Promise<{ key: string[] }> };

// 開発時だけの配信ルート（設計書 §5.9・C-02）。`PUBLIC_FILES_BASE_URL=http://localhost:3000/dev-files`
// 本番は Cloudflare（公開用バケットを独自ドメインか Workers で配信）なので、**R2 のときは動かさない**
// 公開用のファイルに付ける Content-Disposition のファイル名は R2 に置くときに付く（ローカルは付けない）
export async function GET(_request: Request, { params }: Props): Promise<Response> {
  const storage = getStorage();
  if (storage.driver !== "local") return new Response(null, { status: 404 });

  const { key: segments } = await params;
  const key = segments.join("/");
  try {
    assertStorageKey(key);
  } catch {
    return new Response(null, { status: 404 });
  }

  const body = await storage.get("public", key);
  if (!body) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
      "content-disposition": "inline",
      "cache-control": "no-store",
    },
  });
}
