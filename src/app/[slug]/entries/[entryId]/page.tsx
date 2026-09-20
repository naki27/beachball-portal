import type { Metadata } from "next";
import Link from "next/link";
import { EntrySteps } from "@/components/entries/entry-steps";
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
// `?done=1` で来たときは「入力 → 確認 → 完了」の完了として出す。変更・取消は B-12
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      {justDone ? <EntrySteps current="done" /> : null}
      <h1 className="text-2xl font-bold break-words">
        {justDone ? `${entry.tournamentName}のお申し込みを受け付けました` : "申し込みの内容"}
      </h1>
      {justDone ? (
        <Message kind="success" title="申し込みが完了しました">
          <p>控えのメールをお送りしました。届かないときは、迷惑メールのフォルダもご確認ください。</p>
        </Message>
      ) : null}
      {entry.status === "cancelled" ? <Message kind="info" title="この申し込みは取り消されています" /> : null}

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

      {/* 変更方法の文言は §4.4 の定型文。変更・取消の操作は B-12 */}
      <Message kind="info" title="変更・取り消しについて">
        <p>締切（{deadline}）までは、このページから変更・取り消しができるようになります。</p>
        <p className="mt-1">
          締切を過ぎてからの変更は、
          <Link href={`/${association.slug}/contact?tournament=${entry.tournamentId}`} className="underline underline-offset-2">
            問い合わせフォーム
          </Link>
          からご連絡ください。
        </p>
      </Message>

      <p>
        <Link href={`/${association.slug}/tournaments/${entry.tournamentId}`} className="underline underline-offset-2">
          ← 大会のページへ
        </Link>
      </p>
    </main>
  );
}
