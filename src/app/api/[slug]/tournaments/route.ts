import { getDb } from "@/db/client";
import { resolveAssociationForApi } from "@/lib/api/resolve";
import { listTournamentsForPublic } from "@/lib/public/tournaments";

type Props = { params: Promise<{ slug: string }> };

// GET /api/[slug]/tournaments — 公開中の大会の一覧（設計書 §10・§5.6）。ログインは要らない
// 準備中（draft）の大会は出さない。選手の情報は含まない
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const resolved = await resolveAssociationForApi(slug, request);
  if (resolved instanceof Response) return resolved;
  const list = await listTournamentsForPublic(getDb(), resolved.association.id);
  return Response.json({ ok: true, ...list }, { headers: { "cache-control": "no-store" } });
}
