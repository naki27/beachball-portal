import type { Metadata } from "next";
import Link from "next/link";
import { DocumentList } from "@/components/tournaments/document-list";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, DescriptionList, DescriptionRow, EmptyState, PageHeader, PageMain, Section } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateWithWeekday } from "@/lib/date";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { getTournamentForPublic, listDocumentsForPublic } from "@/lib/public/tournaments";
import { ageReferenceText } from "@/lib/tournaments/category-text";
import { type DeadlineTone, deadlineText, deadlineTone } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "大会の詳細" };

// 締切の色（§4.5）。色だけに頼らず、文字（あと◯日／今日まで）も必ず出す
const TONE: Record<DeadlineTone, "neutral" | "brand" | "warning" | "danger"> = {
  past: "neutral",
  today: "danger",
  soon: "warning",
  normal: "brand",
};

// 大会詳細（公開ページ・設計書 §4.2 #6・§5.6）。未ログインでも見られる。準備中（draft）の大会は 404
// スマホは 1 列（申し込みの案内が先）、1280px からは本文と申し込みの 2 列（§4.3・ADR 0028）
// 部ごとに締切が違う大会だけ、部ごとの締切を出す（全部同じならノイズを増やさない・追加仕様 2）
export default async function TournamentPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const now = new Date();
  const tournament = await getTournamentForPublic(getDb(), association.id, tournamentId, now).catch(pageErrorFrom);
  // 公開されている資料（§5.9）。押すとアプリの URL 経由で公開用の URL へ転送される
  const documents = await listDocumentsForPublic(getDb(), association.id, tournament.id);
  const principal = await getPrincipal();
  const mixedDeadlines = tournament.categories.some((c) => c.overridesDeadline);
  const entryHref = `/${association.slug}/tournaments/${tournament.id}/entry`;

  return (
    <PageMain width="wide" gap="lg">
      <p>
        <Link href={`/${association.slug}/tournaments`} className="bb-link text-primary">
          ← 大会一覧
        </Link>
      </p>
      <PageHeader
        tone="hero"
        eyebrow={association.name}
        title={tournament.name}
        lead={
          <>
            {tournament.eventDate ? `${tournament.eventDate.year}年${formatDateWithWeekday(tournament.eventDate)}開催` : "開催日は未定"}
            {tournament.venue ? `・${tournament.venue}` : ""}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 申し込みの案内。スマホでは先に出し、PC では右の列に置く */}
        <aside className="flex flex-col gap-3 lg:order-2 lg:col-span-1 lg:sticky lg:top-24 lg:self-start">
          <Card tone="soft" className="flex flex-col gap-3">
            <Badge tone={TONE[deadlineTone(tournament.entryEndAt, now)]}>{deadlineText(tournament.entryEndAt, now)}</Badge>
            {tournament.state === "open" ? (
              principal.userId ? (
                <Link href={entryHref} className={buttonClass("primary", true)}>
                  申し込む
                </Link>
              ) : (
                <Link href={`/login?next=${encodeURIComponent(entryHref)}`} className={buttonClass("primary", true)}>
                  ログインして申し込む
                </Link>
              )
            ) : (
              <Message kind="info" title={stateTitle(tournament.state)} />
            )}
            <Link
              href={`/${association.slug}/tournaments/${tournament.id}/entries`}
              className="bb-link flex min-h-11 items-center justify-center font-semibold text-primary"
            >
              参加チーム一覧（{tournament.teams} チーム）
            </Link>
          </Card>
        </aside>

        <div className="flex flex-col gap-6 lg:order-1 lg:col-span-2">
          <DescriptionList>
            <DescriptionRow label="開催日">
              {tournament.eventDate ? `${tournament.eventDate.year}年${formatDateWithWeekday(tournament.eventDate)}` : "未定"}
            </DescriptionRow>
            {tournament.venue ? <DescriptionRow label="会場">{tournament.venue}</DescriptionRow> : null}
            <DescriptionRow label="1 チームの人数">
              {tournament.teamSizeMin} 人以上 {tournament.teamSizeMax} 人以内
            </DescriptionRow>
            <DescriptionRow label="年齢の判定">{ageReferenceText(tournament.ageReferenceDate)}の年齢で判定します</DescriptionRow>
          </DescriptionList>

          {tournament.description ? <p className="leading-relaxed whitespace-pre-wrap">{tournament.description}</p> : null}

          <Section id="categories" title="出場する部">
            {tournament.categories.length === 0 ? (
              <EmptyState title="部はまだ決まっていません" />
            ) : (
              <ul className="bb-stagger grid gap-3 sm:grid-cols-2">
                {tournament.categories.map((category) => (
                  <li key={category.id}>
                    <Card hoverable className="flex h-full flex-col gap-1">
                      <p className="font-semibold break-words">{category.label}</p>
                      <p className="text-sm text-muted">{category.condition}</p>
                      {/* 部ごとに締切が違う大会だけ、部の締切を出す */}
                      {mixedDeadlines ? <p className="text-sm text-muted">{deadlineText(category.entryEndAt, now)}</p> : null}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <DocumentList
            documents={documents.map((document) => ({
              ...document,
              href: `/${association.slug}/tournaments/${tournament.id}/documents/${document.id}`,
            }))}
          />
        </div>
      </div>
    </PageMain>
  );
}

// 申し込めないときの案内（内部の値は出さない・§4.4）
function stateTitle(state: string): string {
  if (state === "not_started") return "申し込みの受付はまだ始まっていません";
  if (state === "closed") return "申し込みの受付は終了しました";
  return "この大会は申し込みを受け付けていません";
}
