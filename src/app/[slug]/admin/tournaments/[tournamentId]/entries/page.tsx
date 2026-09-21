import type { Metadata } from "next";
import Link from "next/link";
import { primaryButtonClass, secondaryButtonClass } from "@/components/button-classes";
import { Badge, Card, EmptyState, PageHeader, PageMain, Toolbar } from "@/components/ui/layout";
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
    <PageMain width="full">
      <p>
        <Link href={`/${association.slug}/admin/tournaments/${tournament.id}`} className="bb-link text-primary no-underline">
          ← {tournament.name}
        </Link>
      </p>
      <PageHeader
        title={`${tournament.name}の申し込み`}
        actions={
          <Link href={`/${association.slug}/tournaments/${tournament.id}/entry`} className={secondaryButtonClass}>
            この大会に申し込む（管理者として）
          </Link>
        }
      />
      <Toolbar>
        <Badge tone="brand">{view.entries.length} チーム</Badge>
        {view.countsByCategory.map((c) => (
          <Badge key={c.label} tone="neutral">
            {c.label} {c.count}
          </Badge>
        ))}
        {/* CSV（§5.5(f)）。出力したことは記録される */}
        <form
          method="post"
          action={`/api/${association.slug}/admin/tournaments/${tournament.id}/entries/exports`}
          className="ml-auto flex flex-wrap items-center gap-2"
        >
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="include_birth_date" className="size-5" />
            生年月日を含める
          </label>
          <button type="submit" className={primaryButtonClass}>
            CSV をダウンロード
          </button>
        </form>
      </Toolbar>
      <p className="text-sm text-muted">
        CSV は 1 人 1 行で出ます。取り消された申し込みは含みません。出力したことは記録されます（誰がいつ出したか）。
        管理者は、締切を過ぎた部や定員を超えていても登録できます。
      </p>
      {needsCheck > 0 ? (
        <Message kind="info" title={`確認が必要な申し込みが ${needsCheck} 件あります`}>
          <p>合計年齢の部や、同じ人物の可能性がある選手を含む申し込みです。内容を確かめて「確認済みにする」を押してください。</p>
        </Message>
      ) : null}

      {view.entries.length === 0 ? (
        <EmptyState title="まだ申し込みはありません" />
      ) : (
        <ul className="bb-stagger grid gap-3 xl:grid-cols-2">
          {view.entries.map((entry) => (
            <li key={entry.entryId}>
              <Card className="flex h-full flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {/* min-w-0: 長いチーム名が flex の升目を押し広げないように（U-06） */}
                <h2 className="min-w-0 text-lg font-bold break-words">{entry.teamName}</h2>
                <p className="text-sm text-muted">{entry.categoryLabel}</p>
              </div>
              {entry.needsAdminCheck ? (
                <p data-testid="needs-check">
                  <Badge tone="danger">要確認</Badge>
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
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-2">
                <Link href={`/${association.slug}/entries/${entry.entryId}`} className="bb-link inline-flex min-h-11 items-center text-primary no-underline">
                  内容を見る
                </Link>
                <Link href={`/${association.slug}/entries/${entry.entryId}/edit`} className="bb-link inline-flex min-h-11 items-center text-primary no-underline">
                  代理で直す
                </Link>
                {entry.needsAdminCheck ? <CheckedButton slug={association.slug} entryId={entry.entryId} /> : null}
                <DeleteEntryButton slug={association.slug} entryId={entry.entryId} />
              </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  );
}
