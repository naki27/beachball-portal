import type { Metadata } from "next";
import Link from "next/link";
import { type AgeWarningView, CategoryManager, type CategoryRowView } from "@/components/tournaments/category-manager";
import { TournamentForm, type TournamentFormValues } from "@/components/tournaments/tournament-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader, PageMain, Section } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { type AdminCategoriesView, getCategoriesForAdmin } from "@/lib/admin/categories";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateWithWeekday, formatPlainDate, type PlainDate, todayInTokyo } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import type { Tournament } from "@/lib/repo/tournaments";
import { categoryConditionText } from "@/lib/tournaments/category-text";
import { DeleteTournament } from "./delete-tournament";

type Props = {
  params: Promise<{ slug: string; tournamentId: string }>;
  searchParams: Promise<{ created?: string; added?: string; skipped?: string }>;
};

export const metadata: Metadata = { title: "大会の編集" };

// 大会の編集・状態の変更と、出場する部の管理（設計書 §4.2 #13・§5.4）。テナント管理者だけ
export default async function EditTournamentPage({ params, searchParams }: Props) {
  const { slug, tournamentId } = await params;
  const { created, added, skipped } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const view = await getCategoriesForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, tournamentId).catch(pageErrorFrom);
  const { tournament } = view;

  return (
    <PageMain width="wide" gap="lg">
      <p>
        <Link href={`/${association.slug}/admin/tournaments`} className="bb-link text-primary no-underline">
          ← 大会の管理
        </Link>
      </p>
      <PageHeader
        title={tournament.name}
        actions={
          <>
            <Link
              href={`/${association.slug}/admin/tournaments/${tournament.id}/entries`}
              className={buttonClass("secondary", false, "sm")}
            >
              申し込みの管理
            </Link>
            <Link
              href={`/${association.slug}/admin/tournaments/${tournament.id}/documents`}
              className={buttonClass("secondary", false, "sm")}
            >
              大会の資料
            </Link>
          </>
        }
      />
      {created ? <Message kind="success" title="大会を作りました" /> : null}
      <Section id="tournament" title="大会の内容">
        <TournamentForm
          slug={association.slug}
          mode="edit"
          tournamentId={tournament.id}
          initial={toFormValues(tournament)}
          hasCategoryDeadlines={view.categories.some((c) => c.entryEndAt !== null)}
        />
      </Section>
      <Section
        id="categories"
        title="出場する部"
        description="候補に出す部は「協会の設定」の「よく使う部」で増やせます。"
      >
        <CategoryManager
          slug={association.slug}
          tournamentId={tournament.id}
          categories={view.categories.map(toCategoryRow)}
          ageWarnings={view.ageWarnings.map(toAgeWarning)}
          tournamentEntryEndText={dateText(todayInTokyo(tournament.entryEndAt))}
          tournamentAgeReferenceText={dateText(tournament.ageReferenceDate)}
          addedCount={Number(added ?? 0)}
          skippedCount={Number(skipped ?? 0)}
        />
      </Section>
      <Section id="delete" title="この大会を削除する">
        <DeleteTournament
          slug={association.slug}
          tournamentId={tournament.id}
          entryCount={view.categories.reduce((total, c) => total + c.entries, 0)}
        />
      </Section>
    </PageMain>
  );
}

// 画面に出す日付（「2026年9月30日（水）」）
function dateText(d: PlainDate): string {
  return `${d.year}年${formatDateWithWeekday(d)}`;
}

function toCategoryRow(c: AdminCategoriesView["categories"][number]): CategoryRowView {
  return {
    id: c.id,
    label: c.label,
    condition: categoryConditionText(c, c.effectiveAgeReferenceDate),
    entries: c.entries,
    entryEndDate: c.entryEndAt ? formatPlainDate(todayInTokyo(c.entryEndAt)) : "",
    ageReferenceDate: c.ageReferenceDate ? formatPlainDate(c.ageReferenceDate) : "",
    maxEntries: c.maxEntries === null ? "" : String(c.maxEntries),
    effectiveEntryEndText: dateText(todayInTokyo(c.effectiveEntryEndAt)),
    effectiveAgeReferenceText: dateText(c.effectiveAgeReferenceDate),
  };
}

// 年齢だけを渡す（生年月日は画面にも API にも出さない・§5.16）
function toAgeWarning(w: AdminCategoriesView["ageWarnings"][number]): AgeWarningView {
  return {
    ...w,
    players: w.players.map((p) => ({ name: p.name, before: p.before === null ? "未記録" : `${p.before}歳`, after: p.after })),
  };
}

// 保存されている値を画面の入力欄の形（文字列）に戻す。締切・開始の瞬間は日本時間の年月日に直す
function toFormValues(t: Tournament): TournamentFormValues {
  return {
    name: t.name,
    eventDate: t.eventDate ? formatPlainDate(t.eventDate) : "",
    ageReferenceDate: formatPlainDate(t.ageReferenceDate),
    venue: t.venue ?? "",
    description: t.description ?? "",
    entryStartDate: t.entryStartAt ? formatPlainDate(todayInTokyo(t.entryStartAt)) : "",
    entryEndDate: formatPlainDate(todayInTokyo(t.entryEndAt)),
    teamSizeMin: String(t.teamSizeMin),
    teamSizeMax: String(t.teamSizeMax),
    maxEntries: t.maxEntries === null ? "" : String(t.maxEntries),
    status: t.status,
  };
}
