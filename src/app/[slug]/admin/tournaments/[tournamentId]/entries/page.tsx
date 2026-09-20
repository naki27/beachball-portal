import type { Metadata } from "next";
import Link from "next/link";
import { primaryButtonClass, secondaryButtonClass } from "@/components/button-classes";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { type AdminEntriesView, getAdminEntries } from "@/lib/admin/entries";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateTimeTokyo } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { SEX_LABEL } from "@/lib/teams/player-input";
import { CheckedButton, DeleteEntryButton } from "./checked-button";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "申し込みの管理" };

// 申込管理（設計書 §4.2 #14・§5.5(f)）。テナント管理者だけ
// 取消済み・削除済みの申込は出さない。CSV は 1 選手 1 行、生年月日はチェックを入れたときだけ
export default async function AdminEntriesPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();

  let view: AdminEntriesView;
  try {
    view = await getAdminEntries(getDb(), { ...principal, userId: principal.userId }, association.id, tournamentId);
  } catch (error) {
    pageErrorFrom(error);
  }

  const { tournament } = view;
  const needsCheck = view.entries.filter((entry) => entry.needsAdminCheck).length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin/tournaments/${tournament.id}`} className="underline underline-offset-2">
          ← {tournament.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold break-words">{tournament.name}の申し込み</h1>
      <p>
        {view.entries.length}チーム
        {view.countsByCategory.length > 0
          ? `（${view.countsByCategory.map((c) => `${c.label} ${c.count}`).join("・")}）`
          : ""}
      </p>
      {needsCheck > 0 ? (
        <Message kind="info" title={`確認が必要な申し込みが ${needsCheck} 件あります`}>
          <p>合計年齢の部や、同じ人物の可能性がある選手を含む申し込みです。内容を確かめて「確認済みにする」を押してください。</p>
        </Message>
      ) : null}

      <section aria-labelledby="entries-csv" className="flex flex-col gap-3 rounded-md border border-border p-4">
        <h2 id="entries-csv" className="text-lg font-bold">
          CSV で出す
        </h2>
        <form method="post" action={`/api/${association.slug}/admin/tournaments/${tournament.id}/entries/exports`} className="flex flex-col gap-3">
          <label className="flex min-h-12 items-center gap-2">
            <input type="checkbox" name="include_birth_date" />
            生年月日を含める
          </label>
          <p className="text-sm text-muted">
            1 人 1 行で出ます。取り消された申し込みは含みません。出力したことは記録されます（誰がいつ出したか）。
          </p>
          <button type="submit" className={`${primaryButtonClass} self-start`}>
            CSV をダウンロード
          </button>
        </form>
      </section>

      <p>
        <Link href={`/${association.slug}/tournaments/${tournament.id}/entry`} className={`${secondaryButtonClass} self-start`}>
          この大会に申し込む（管理者として）
        </Link>
      </p>
      <p className="text-sm text-muted">管理者は、締切を過ぎた部や定員を超えていても登録できます。</p>

      {view.entries.length === 0 ? (
        <p>まだ申し込みはありません。</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {view.entries.map((entry) => (
            <li key={entry.entryId} className="flex flex-col gap-2 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold break-words">{entry.teamName}</h2>
                <p className="text-sm text-muted">{entry.categoryLabel}</p>
              </div>
              {entry.needsAdminCheck ? (
                <p className="text-sm font-semibold text-danger" data-testid="needs-check">
                  要確認
                </p>
              ) : null}
              <ol className="flex flex-col gap-1">
                {entry.players.map((player) => (
                  <li key={player.position} className="text-sm">
                    {player.position}. {player.name}
                    <span className="ml-2 text-muted">
                      {[player.age !== null ? `${player.age}歳` : "", SEX_LABEL[player.sex], player.membershipLabel ?? ""]
                        .filter(Boolean)
                        .join("・")}
                    </span>
                  </li>
                ))}
              </ol>
              {entry.note ? <p className="text-sm whitespace-pre-wrap break-words">備考: {entry.note}</p> : null}
              <p className="text-sm text-muted">申し込み: {formatDateTimeTokyo(entry.submittedAt)}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/${association.slug}/entries/${entry.entryId}`} className="underline underline-offset-2">
                  内容を見る
                </Link>
                <Link href={`/${association.slug}/entries/${entry.entryId}/edit`} className="underline underline-offset-2">
                  代理で直す
                </Link>
                {entry.needsAdminCheck ? <CheckedButton slug={association.slug} entryId={entry.entryId} /> : null}
                <DeleteEntryButton slug={association.slug} entryId={entry.entryId} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
