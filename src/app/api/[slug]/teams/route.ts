import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { parseTeamInput } from "@/lib/teams/team-input";
import { registerIndividual } from "@/lib/teams/self";
import { registerTeam } from "@/lib/teams/teams";

type Props = { params: Promise<{ slug: string }> };

// POST /api/[slug]/teams — 「チームで登録」「個人で登録」（設計書 §5.11。{ kind: "team" | "individual", … }）。ログインした人なら誰でも
// チーム: 作った人が代表者になる。同名のチームがあれば 409（error.sameName）。confirmSameName: true で、別のチームとして作る
// 個人: 本人の情報（氏名・ふりがな・生年月日・性別）だけ。すでに紐づいた人物があれば入力は見ない。1 協会 1 つ（409）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "チーム名を入力してください", { field: "name" });
  if (body.kind === "individual") {
    try {
      const { team } = await registerIndividual(getDb(), gate.principal, gate.association.id, body);
      return Response.json(
        { ok: true, team: { id: team.id }, redirectTo: `/${gate.association.slug}/teams/${team.id}?created=1` },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return teamErrorResponse(error);
    }
  }
  const parsed = parseTeamInput(body);
  if (!parsed.ok) return jsonError(400, parsed.message, { field: parsed.field });
  try {
    const team = await registerTeam(getDb(), gate.association.id, gate.principal.userId, parsed.value, {
      confirmSameName: body.confirmSameName === true,
    });
    return Response.json(
      { ok: true, team: { id: team.id, name: team.name }, redirectTo: `/${gate.association.slug}/teams/${team.id}?created=1` },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return teamErrorResponse(error);
  }
}
