import { getPool } from "@/db/client";

// GET /api/health — DB に select 1 が通れば ok（テナントに属さない API。設計書 §5.14「URL とテナント」）
export async function GET(): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  try {
    await getPool().query("select 1");
    return Response.json({ ok: true }, { headers });
  } catch {
    // 失敗の中身（ホスト名など）は返さない
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
