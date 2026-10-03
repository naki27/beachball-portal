import { LOCAL_STORAGE_ROOT } from "@/lib/storage";
import { readLocalFile } from "@/lib/storage/local";

type Props = { params: Promise<{ key: string[] }> };

// GET /dev-files/<名前> — 開発時だけのルート（設計書 §5.9・ADR 0026）。`.local-storage/public/` のファイルをそのまま返す
// 本番では R2 の公開用バケットを独自ドメインで配信するので、このルートは使わない（production では 404）
export async function GET(_request: Request, { params }: Props): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { key } = await params;
  const file = await readLocalFile(LOCAL_STORAGE_ROOT, "public", key.join("/"));
  if (!file) return new Response(null, { status: 404 });
  const headers: Record<string, string> = { "content-type": file.contentType, "cache-control": "no-store" };
  if (file.contentDisposition) headers["content-disposition"] = file.contentDisposition;
  return new Response(Buffer.from(file.body), { headers });
}
