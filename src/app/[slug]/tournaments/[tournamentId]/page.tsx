import type { Metadata } from "next";
import Link from "next/link";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { formatDateWithWeekday } from "@/lib/date";
import { getPrincipal } from "@/lib/auth/principal";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { getTournamentForPublic } from "@/lib/public/tournaments";
import { ageReferenceText } from "@/lib/tournaments/category-text";
import { deadlineText } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "大会の詳細" };

// 大会詳細（公開ページ・設計書 §4.2 #6・§5.6）。未ログインでも見られる。準備中（draft）の大会は 404
// 部ごとに締切が違う大会だけ、部ごとの締切を出す（全部同じならノイズを増やさない・追加仕様 2）
export default async function TournamentPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const now = new Date();
  const tournament = await getTournamentForPublic(getDb(), association.id, tournamentId, now).catch(pageErrorFrom);
  const principal = await getPrincipal();
  const mixedDeadlines = tournament.categories.some((c) => c.overridesDeadline);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/tournaments`} className="underline underline-offset-2">
          ← 大会一覧
        </Link>
      </p>
      <h1 className="text-2xl font-bold break-words">{tournament.name}</h1>

      <dl className="flex flex-col gap-2">
        <Row label="開催日">
          {tournament.eventDate ? `${tournament.eventDate.year}年${formatDateWithWeekday(tournament.eventDate)}` : "未定"}
        </Row>
        {tournament.venue ? <Row label="会場">{tournament.venue}</Row> : null}
        <Row label="申し込み">{deadlineText(tournament.entryEndAt, now)}</Row>
        <Row label="1 チームの人数">
          {tournament.teamSizeMin} 人以上 {tournament.teamSizeMax} 人以内
        </Row>
        <Row label="年齢の判定">{ageReferenceText(tournament.ageReferenceDate)}の年齢で判定します</Row>
      </dl>

      {tournament.description ? <p className="leading-relaxed whitespace-pre-wrap">{tournament.description}</p> : null}

      {tournament.state === "open" ? (
        principal.userId ? (
          <Link
            href={`/${association.slug}/tournaments/${tournament.id}/entry`}
            className="bb-pressable flex min-h-12 items-center justify-center rounded-md bg-primary px-4 font-semibold text-on-primary no-underline"
          >
            申し込む
          </Link>
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(`/${association.slug}/tournaments/${tournament.id}/entry`)}`}
            className="bb-pressable flex min-h-12 items-center justify-center rounded-md bg-primary px-4 font-semibold text-on-primary no-underline"
          >
            ログインして申し込む
          </Link>
        )
      ) : (
        <Message kind="info" title={stateTitle(tournament.state)} />
      )}

      <section aria-labelledby="categories" className="flex flex-col gap-3">
        <h2 id="categories" className="text-lg font-bold">
          出場する部
        </h2>
        {tournament.categories.length === 0 ? (
          <p className="leading-relaxed text-muted">部はまだ決まっていません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tournament.categories.map((category) => (
              <li key={category.id} className="rounded-md border border-border px-4 py-3">
                <p className="font-semibold break-words">{category.label}</p>
                <p className="text-sm text-muted">{category.condition}</p>
                {/* 部ごとに締切が違う大会だけ、部の締切を出す */}
                {mixedDeadlines ? <p className="text-sm text-muted">{deadlineText(category.entryEndAt, now)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <Link href={`/${association.slug}/tournaments/${tournament.id}/entries`} className="font-semibold underline underline-offset-2">
          参加チーム一覧（{tournament.teams} チーム）
        </Link>
      </p>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="font-semibold">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// 申し込めないときの案内（内部の値は出さない・§4.4）
function stateTitle(state: string): string {
  if (state === "not_started") return "申し込みの受付はまだ始まっていません";
  if (state === "closed") return "申し込みの受付は終了しました";
  return "この大会は申し込みを受け付けていません";
}
