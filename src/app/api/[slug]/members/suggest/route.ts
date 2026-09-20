import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { fiscalYear, todayInTokyo } from "@/lib/date";
import { suggestMembers } from "@/lib/search/suggest-members";
import { toSuggestionResponse } from "@/lib/search/response";

type Props = { params: Promise<{ slug: string }> };

// POST /api/[slug]/members/suggest — 申込の選手枠のサジェスト（設計書 §8.4・§10）
// **氏名は URL に載せない**ので POST の本文で受ける（クエリ文字列はリクエストログに残る・§12）
// 候補は代表者を務めるチームの選手だけ。代表者を務めるチームがなければ 0 件（403 にはしない）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;

  const body = (await readJson(request)) ?? {};
  const q = typeof body.q === "string" ? body.q : "";
  const membersOnly = body.members_only === true;
  const year = typeof body.year === "number" && Number.isInteger(body.year) ? body.year : fiscalYear(todayInTokyo(), gate.association.fiscalYearStartMonth);

  try {
    const rows = await suggestMembers(getDb(), gate.association.id, gate.principal.userId, { q, membersOnly, year });
    return Response.json({ ok: true, members: rows.map(toSuggestionResponse) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
