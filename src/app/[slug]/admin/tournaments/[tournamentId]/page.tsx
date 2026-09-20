import type { Metadata } from "next";
import Link from "next/link";
import { TournamentForm, type TournamentFormValues } from "@/components/tournaments/tournament-form";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getTournamentForAdmin } from "@/lib/admin/tournaments";
import { getPrincipal } from "@/lib/auth/principal";
import { formatPlainDate, todayInTokyo } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import type { Tournament } from "@/lib/repo/tournaments";

type Props = { params: Promise<{ slug: string; tournamentId: string }>; searchParams: Promise<{ created?: string }> };

export const metadata: Metadata = { title: "大会の編集" };

// 大会の編集と状態の変更（設計書 §4.2 #13・§5.4）。テナント管理者だけ。部の管理は B-05
export default async function EditTournamentPage({ params, searchParams }: Props) {
  const { slug, tournamentId } = await params;
  const { created } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const tournament = await getTournamentForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, tournamentId).catch(pageErrorFrom);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin/tournaments`} className="underline underline-offset-2">
          ← 大会の管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold break-words">{tournament.name}</h1>
      {created ? <Message kind="success" title="大会を作りました" /> : null}
      <Message kind="info" title="出場する部の設定は準備中です">
        <p>いまは大会の情報だけを登録できます。</p>
      </Message>
      <TournamentForm slug={association.slug} mode="edit" tournamentId={tournament.id} initial={toFormValues(tournament)} />
    </main>
  );
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
