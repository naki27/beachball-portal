import { getDb } from "@/db/client";
import { requireLoggedIn } from "@/lib/api/me";
import { listMyAssociations } from "@/lib/repo/associations";

// GET /api/me/associations — ログイン中の人が役割を持つ協会（設計書 §5.14「協会をまたぐ画面」）。名前とスラッグだけ
export async function GET(request: Request): Promise<Response> {
  const gate = await requireLoggedIn(request);
  if (gate instanceof Response) return gate;
  const associations = await listMyAssociations(getDb(), gate.principal.userId);
  return Response.json(
    { associations: associations.map((a) => ({ name: a.name, slug: a.slug })) },
    { headers: { "cache-control": "no-store" } },
  );
}
