import type { Metadata } from "next";
import Link from "next/link";
import { PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { getEntryTeamsForPublic } from "@/lib/public/tournaments";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "参加チーム一覧" };

// 参加チーム一覧（公開ページ・設計書 §4.2 #10・§5.6）
// **部・チーム名・チーム数だけ**。選手の氏名・生年月日・性別・連絡先は出さない（自チームの選手はチーム管理で見る）
export default async function EntriesPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const { tournament, groups } = await getEntryTeamsForPublic(getDb(), association.id, tournamentId).catch(pageErrorFrom);

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/tournaments/${tournament.id}`} className="underline underline-offset-2">
          ← {tournament.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">参加チーム一覧</h1>
      <p className="text-sm text-muted">全 {tournament.teams} チーム。選手のお名前は出していません。</p>
      {groups.length === 0 ? (
        <p className="leading-relaxed">部はまだ決まっていません。</p>
      ) : (
        groups.map((group) => (
          <section key={group.categoryId} aria-labelledby={`group-${group.categoryId}`} className="flex flex-col gap-2">
            <h2 id={`group-${group.categoryId}`} className="text-lg font-bold break-words">
              {group.label}（{group.teams.length} チーム）
            </h2>
            {group.teams.length === 0 ? (
              <p className="leading-relaxed text-muted">まだ申し込みはありません。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {group.teams.map((team, index) => (
                  <li key={`${group.categoryId}-${index}`} className="break-words">
                    {team}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </PageMain>
  );
}
