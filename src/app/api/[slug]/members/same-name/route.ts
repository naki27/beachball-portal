import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { fiscalYear, todayInTokyo } from "@/lib/date";
import { findSameNameMembers } from "@/lib/search/suggest-members";
import { toSuggestionResponse } from "@/lib/search/response";

type Props = { params: Promise<{ slug: string }> };

// POST /api/[slug]/members/same-name — 「この方ですか？」の候補（設計書 §8.3・§10）
// 氏名（正規化後）が**完全に一致**する人だけ。範囲はサジェストと同じで、代表者を務めるチームの選手に限る
// 入力は氏名だけ（§10）。協会員かどうかは、いまの年度で見る
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;

  const body = (await readJson(request)) ?? {};
  const name = typeof body.name === "string" ? body.name : "";
  const year = fiscalYear(todayInTokyo(), gate.association.fiscalYearStartMonth);

  try {
    const rows = await findSameNameMembers(getDb(), gate.association.id, gate.principal.userId, { name, year });
    return Response.json({ ok: true, members: rows.map(toSuggestionResponse) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
