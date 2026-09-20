import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { submitDeclaration } from "@/lib/memberships/declaration";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// POST /api/[slug]/teams/[teamId]/membership — 年度更新の申告の送信（設計書 §5.12）。チームの代表者だけ
// 何度でも送り直せる（締切前）。締切後は 409。全員のチェックを外して送っても「申告済み」になる
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "登録する人を選んでください", { field: "memberIds" });
  try {
    const result = await submitDeclaration(getDb(), gate.principal, gate.association.id, teamId, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
