import type { Metadata } from "next";
import Link from "next/link";
import { PlayerForm } from "@/components/teams/player-form";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { getPlayerForEdit } from "@/lib/teams/roster";

type Props = { params: Promise<{ slug: string; teamId: string; teamMemberId: string }> };

export const metadata: Metadata = { title: "選手の情報の修正" };

// 選手の情報の修正（§5.11）。代表者だけ。人物はほかのチームとも共有されている
// 個人登録（kind = individual）では「あなたの登録情報の修正」
export default async function EditPlayerPage({ params }: Props) {
  const { slug, teamId, teamMemberId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const { team, player } = await getPlayerForEdit(
    getDb(),
    { ...principal, userId: principal.userId },
    association.id,
    teamId,
    teamMemberId,
  ).catch(pageErrorFrom);
  const individual = team.kind === "individual";
  const backPath = individual ? `/${association.slug}/teams/${team.id}` : `/${association.slug}/teams/${team.id}/members`;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={backPath} className="underline underline-offset-2">
          ← {individual ? "あなたの登録情報" : "選手一覧"}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{individual ? "あなたの登録情報の修正" : "選手の情報の修正"}</h1>
      <p className="text-sm text-muted">
        {individual
          ? "ほかのチームの選手一覧にもあなたが載っている場合、そちらにも同じ内容が反映されます。"
          : "この方がほかのチームの選手一覧にもいる場合、そちらにも同じ内容が反映されます。"}
      </p>
      <PlayerForm
        submit={{
          url: `/api/${association.slug}/teams/${team.id}/members/${teamMemberId}`,
          method: "PATCH",
          successPath: `${backPath}?updated=1`,
          label: "保存する",
          pendingLabel: "保存しています…",
        }}
        initial={{ name: player.name, kana: player.kana ?? "", birthDate: player.birthDate, sex: player.sex }}
      />
    </main>
  );
}
