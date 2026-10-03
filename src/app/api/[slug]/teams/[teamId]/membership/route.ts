import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { submitDeclaration } from "@/lib/memberships/declaration";

type Props = { params: Promise<{ slug: string; teamId: string }> };

// POST /api/[slug]/teams/[teamId]/membership — 年度更新の申告を送る／直す（設計書 §5.12「申告フロー」）
// { memberIds: string[] }（その年度も登録する人）。代表者だけ。締切後は 409（テナント管理者は代理で送れる）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, teamId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "登録する人の選び方が正しくありません");
  try {
    const result = await submitDeclaration(getDb(), gate.principal, gate.association.id, teamId, body);
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
