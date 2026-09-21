import type { Metadata } from "next";
import Link from "next/link";
import { TournamentCard, TournamentGrid } from "@/components/tournaments/tournament-card";
import { EmptyState, PageHeader, PageMain, Section } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { requireAssociation } from "@/lib/page/require-association";
import { listTournamentsForPublic, type PublicTournament } from "@/lib/public/tournaments";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "大会一覧" };

// 大会一覧（公開ページ・設計書 §5.6）。ログインしていなくても見られる。準備中の大会は出さない
// スマホは 1 列、768px から 2 列、1280px から 3 列（§4.3・ADR 0028）
export default async function TournamentsPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const now = new Date();
  const list = await listTournamentsForPublic(getDb(), association.id, now);

  return (
    <PageMain width="wide" gap="lg">
      <p>
        <Link href={`/${association.slug}`} className="bb-link text-primary">
          ← {association.name}
        </Link>
      </p>
      <PageHeader title="大会一覧" eyebrow={association.name} />
      <Group slug={association.slug} title="受付中の大会" rows={list.open} now={now} empty="いま申し込みを受け付けている大会はありません。" />
      <Group slug={association.slug} title="今後の大会" rows={list.upcoming} now={now} empty="予定されている大会はありません。" />
      <Group slug={association.slug} title="終わった大会" rows={list.past} now={now} empty="終わった大会はまだありません。" />
    </PageMain>
  );
}

function Group({ slug, title, rows, now, empty }: { slug: string; title: string; rows: PublicTournament[]; now: Date; empty: string }) {
  return (
    <Section id={`group-${title}`} title={title}>
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <TournamentGrid>
          {rows.map((t) => (
            <TournamentCard key={t.id} slug={slug} tournament={t} now={now} />
          ))}
        </TournamentGrid>
      )}
    </Section>
  );
}
