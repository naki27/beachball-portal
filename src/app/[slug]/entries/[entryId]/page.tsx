import type { Metadata } from "next";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/button-classes";
import { EntryCancel } from "@/components/entries/entry-cancel";
import { EntrySteps } from "@/components/entries/entry-steps";
import { Card, PageHeader, PageMain } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { type EntryDetail, getEntryDetail } from "@/lib/entries/entry-detail";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { SEX_LABEL } from "@/lib/teams/player-input";

type Props = {
  params: Promise<{ slug: string; entryId: string }>;
  searchParams: Promise<{ done?: string }>;
};

export const metadata: Metadata = { title: "申し込みの内容" };

// 申込の確認ページ（設計書 §5.7 の完了画面・§4.2）。メールからもここに来る（ログインしていなければ 403）
// `?done=1` で来たときは「入力 → 確認 → 完了」の完了として出す
// 締切前の代表者には変更・取消の導線、締切後は読み取り専用と問い合わせの導線（§5.5(d)）
export default async function EntryPage({ params, searchParams }: Props) {
  const { slug, entryId } = await params;
  const { done } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();

  let entry: EntryDetail;
  try {
    entry = await getEntryDetail(getDb(), principal, association.id, entryId);
  } catch (error) {
    pageErrorFrom(error);
  }

  const justDone = done === "1";
  const deadline = formatDateWithWeekday(todayInTokyo(entry.deadline));

  return (
    <PageMain>
      {justDone ? <EntrySteps current="done" /> : null}
      <PageHeader
        eyebrow={justDone ? undefined : entry.tournamentName}
        title={justDone ? `${entry.tournamentName}のお申し込みを受け付けました` : "申し込みの内容"}
      />
      {justDone ? (
        <Message kind="success" title="申し込みが完了しました">
          <p>控えのメールをお送りしました。届かないときは、迷惑メールのフォルダもご確認ください。</p>
        </Message>
      ) : null}
      {entry.status === "cancelled" ? (
        <Message kind="info" title="この申し込みは取り消されています">
          <p>取り消した申し込みは元に戻せません。もう一度出る場合は、締切までに申し込み直してください。</p>
        </Message>
      ) : null}
      {entry.warnings.map((warning) => (
        <Message key={warning} kind="info" title={warning}>
          <p>間違いでなければ、そのままで問題ありません。チーム同士でご確認ください。</p>
        </Message>
      ))}

      <Card>
        <dl className="flex flex-col gap-3">
        <div>
          <dt className="font-semibold">申込番号</dt>
          <dd className="break-all font-mono text-sm">{entry.entryId}</dd>
        </div>
        <div>
          <dt className="font-semibold">大会</dt>
          <dd>
            <Link href={`/${association.slug}/tournaments/${entry.tournamentId}`} className="underline underline-offset-2">
              {entry.tournamentName}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">部</dt>
          <dd>{entry.categoryLabel}</dd>
        </div>
        <div>
          <dt className="font-semibold">チーム名</dt>
          <dd className="break-words">{entry.teamName}</dd>
        </div>
        <div>
          <dt className="font-semibold">出場する選手</dt>
          <dd>
            <ol className="flex flex-col gap-1">
              {entry.players.map((player) => (
                <li key={player.position}>
                  {player.position}. {player.name}
                  {player.personal ? (
                    <span className="ml-2 text-sm text-muted">
                      {[player.personal.age !== null ? `${player.personal.age}歳` : "", SEX_LABEL[player.personal.sex]]
                        .filter(Boolean)
                        .join("・")}
                    </span>
                  ) : null}
                  {/* 申込のあとで脱退・削除された人の印。申込の内容はそのまま残る（§5.5「申込はスナップショット」） */}
                  {player.missingFromRoster ? <span className="ml-2 text-sm font-semibold text-danger">選手一覧にいません</span> : null}
                </li>
              ))}
            </ol>
          </dd>
        </div>
        {entry.note ? (
          <div>
            <dt className="font-semibold">備考</dt>
            <dd className="whitespace-pre-wrap break-words">{entry.note}</dd>
          </div>
        ) : null}
        </dl>
      </Card>

      {/* 変更方法の文言は §4.4 の定型文（§5.5(d)） */}
      {entry.canEdit ? (
        <section aria-labelledby="entry-manage" className="flex flex-col gap-3">
          <h2 id="entry-manage" className="text-lg font-bold">
            変更・取り消し
          </h2>
          <p className="text-sm text-muted">締切（{deadline}）までは、何度でも変えられます。</p>
          <Link
            href={`/${association.slug}/entries/${entry.entryId}/edit`}
            className={`${secondaryButtonClass} self-start`}
          >
            申し込みの内容を変える
          </Link>
          <EntryCancel slug={association.slug} entryId={entry.entryId} />
        </section>
      ) : (
        <Message kind="info" title="変更・取り消しについて">
          {entry.status === "cancelled" ? (
            <p>この申し込みは取り消されています。</p>
          ) : (
            <p>締切（{deadline}）を過ぎたため、このページからは変更・取り消しができません。</p>
          )}
          <p className="mt-1">
            変更が必要なときは、
            <Link href={`/${association.slug}/contact?tournament=${entry.tournamentId}`} className="underline underline-offset-2">
              問い合わせフォーム
            </Link>
            からご連絡ください。
          </p>
        </Message>
      )}

      <p>
        <Link href={`/${association.slug}/tournaments/${entry.tournamentId}`} className="underline underline-offset-2">
          ← 大会のページへ
        </Link>
      </p>
    </PageMain>
  );
}
