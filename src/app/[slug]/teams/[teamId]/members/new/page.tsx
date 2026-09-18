import type { Metadata } from "next";
import Link from "next/link";
import { PlayerForm } from "@/components/teams/player-form";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { getRoster } from "@/lib/teams/roster";
import { TeamError } from "@/lib/teams/errors";

type Props = { params: Promise<{ slug: string; teamId: string }> };

export const metadata: Metadata = { title: "選手の追加" };

// 選手の追加（設計書 §5.11「名簿の管理」）。代表者だけ。本人の情報を入力する（同意の文言・§5.18）
export default async function NewPlayerPage({ params }: Props) {
  const { slug, teamId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const roster = await getRoster(getDb(), { ...principal, userId: principal.userId }, association.id, teamId).catch(pageErrorFrom);
  if (!roster.canManage) pageErrorFrom(new TeamError(403, "チームの代表者だけができます"));

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/teams/${roster.team.id}/members`} className="underline underline-offset-2">
          ← 選手一覧
        </Link>
      </p>
      <h1 className="text-2xl font-bold">選手の追加</h1>
      <p className="rounded-md border border-border bg-info-surface px-4 py-3 leading-relaxed">
        ご本人（未成年の方は保護者）の同意を得て入力してください
      </p>
      <PlayerForm
        slug={association.slug}
        teamId={roster.team.id}
        mode="create"
        initial={{ name: "", kana: "", birthDate: null, sex: "" }}
      />
    </main>
  );
}
