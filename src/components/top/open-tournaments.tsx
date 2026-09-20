import Link from "next/link";
import { TournamentCard } from "@/components/tournaments/tournament-card";
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
      <section aria-labelledby="open-tournaments" className="flex flex-col gap-3">
        <h2 id="open-tournaments" className="text-lg font-bold">
          受付中の大会
        </h2>
        {open.length === 0 ? (
          <p className="leading-relaxed text-muted">いま申し込みを受け付けている大会はありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((t) => (
              <TournamentCard key={t.id} slug={slug} tournament={t} now={now} />
            ))}
          </ul>
        )}
      </section>
      {upcoming.length > 0 ? (
        <section aria-labelledby="upcoming-tournaments" className="flex flex-col gap-3">
          <h2 id="upcoming-tournaments" className="text-lg font-bold">
            今後の大会
          </h2>
          <ul className="flex flex-col gap-2">
            {upcoming.map((t) => (
              <TournamentCard key={t.id} slug={slug} tournament={t} now={now} />
            ))}
          </ul>
        </section>
      ) : null}
      <p>
        <Link href={`/${slug}/tournaments`} className="font-semibold underline underline-offset-2">
          大会一覧を見る
        </Link>
      </p>
    </>
  );
}
