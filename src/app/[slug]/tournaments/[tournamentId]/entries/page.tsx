import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, PageHeader, PageMain } from "@/components/ui/layout";
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
    <PageMain width="wide">
      <p>
        <Link href={`/${association.slug}/tournaments/${tournament.id}`} className="bb-link text-primary no-underline">
          ← {tournament.name}
        </Link>
      </p>
      <PageHeader
        eyebrow={tournament.name}
        title="参加チーム一覧"
        lead={`全 ${tournament.teams} チーム。選手のお名前は出していません。`}
      />
      {groups.length === 0 ? (
        <EmptyState title="部はまだ決まっていません" />
      ) : (
        // 大会当日にスマホでも読む画面（§4.3）。横スクロールさせず、部ごとのカードを並べる
        <div className="bb-stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <section key={group.categoryId} aria-labelledby={`group-${group.categoryId}`}>
              <Card className="flex h-full flex-col gap-2">
                <h2 id={`group-${group.categoryId}`} className="flex items-center gap-2 text-lg font-bold break-words">
                  <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-brand" />
                  {group.label}（{group.teams.length} チーム）
                </h2>
                {group.teams.length === 0 ? (
                  <p className="leading-relaxed text-muted">まだ申し込みはありません。</p>
                ) : (
                  <ol className="flex flex-col gap-1">
                    {group.teams.map((team, index) => (
                      <li key={`${group.categoryId}-${index}`} className="flex gap-2 break-words">
                        <span aria-hidden="true" className="w-5 shrink-0 text-right text-sm text-muted">
                          {index + 1}
                        </span>
                        {team}
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </section>
          ))}
        </div>
      )}
    </PageMain>
  );
}
