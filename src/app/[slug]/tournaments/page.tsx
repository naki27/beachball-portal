import type { Metadata } from "next";
import Link from "next/link";
import { TournamentCard } from "@/components/tournaments/tournament-card";
import { getDb } from "@/db/client";
import { requireAssociation } from "@/lib/page/require-association";
import { listTournamentsForPublic, type PublicTournament } from "@/lib/public/tournaments";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "大会一覧" };

// 大会一覧（公開ページ・設計書 §5.6）。ログインしていなくても見られる。準備中の大会は出さない
export default async function TournamentsPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const now = new Date();
  const list = await listTournamentsForPublic(getDb(), association.id, now);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <p>
        <Link href={`/${association.slug}`} className="underline underline-offset-2">
          ← {association.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">大会一覧</h1>
      <Group slug={association.slug} title="受付中の大会" rows={list.open} now={now} empty="いま申し込みを受け付けている大会はありません。" />
      <Group slug={association.slug} title="今後の大会" rows={list.upcoming} now={now} empty="予定されている大会はありません。" />
      <Group slug={association.slug} title="終わった大会" rows={list.past} now={now} empty="終わった大会はまだありません。" />
    </main>
  );
}

function Group({ slug, title, rows, now, empty }: { slug: string; title: string; rows: PublicTournament[]; now: Date; empty: string }) {
  const id = `group-${title}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-bold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="leading-relaxed text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((t) => (
            <TournamentCard key={t.id} slug={slug} tournament={t} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
