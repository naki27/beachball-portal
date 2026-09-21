import Link from "next/link";
import { TournamentCard, TournamentGrid } from "@/components/tournaments/tournament-card";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, Section } from "@/components/ui/layout";
import type { PublicTournament } from "@/lib/public/tournaments";

// 協会のトップの大会のブロック（設計書 §5.17 の既定の並び・§5.6）。「受付中の大会」と「今後の大会」
export function OpenTournaments({
  slug,
  open,
  upcoming,
  now,
}: {
  slug: string;
  open: PublicTournament[];
  upcoming: PublicTournament[];
  now: Date;
}) {
  return (
    <>
      <Section
        id="open-tournaments"
        title="受付中の大会"
        actions={
          <Link href={`/${slug}/tournaments`} className={buttonClass("secondary", false, "sm")}>
            大会一覧を見る
          </Link>
        }
      >
        {open.length === 0 ? (
          <EmptyState title="いま申し込みを受け付けている大会はありません" description="受付が始まると、ここに出ます。" />
        ) : (
          <TournamentGrid>
            {open.map((t) => (
              <TournamentCard key={t.id} slug={slug} tournament={t} now={now} />
            ))}
          </TournamentGrid>
        )}
      </Section>
      {upcoming.length > 0 ? (
        <Section id="upcoming-tournaments" title="今後の大会">
          <TournamentGrid>
            {upcoming.map((t) => (
              <TournamentCard key={t.id} slug={slug} tournament={t} now={now} />
            ))}
          </TournamentGrid>
        </Section>
      ) : null}
    </>
  );
}
