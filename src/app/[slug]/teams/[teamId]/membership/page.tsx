import type { Metadata } from "next";
import Link from "next/link";
import { DeclarationForm, type DeclarationPlayerView } from "@/components/memberships/declaration-form";
import { PlayerForm } from "@/components/teams/player-form";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateTimeTokyo, formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { type DeclarationPlayer, getDeclarationView } from "@/lib/memberships/declaration";
import { fiscalYearLabel } from "@/lib/memberships/period-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { deadlineText } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string; teamId: string }>; searchParams: Promise<{ added?: string }> };

export const metadata: Metadata = { title: "協会員の登録" };

// 年度更新の申告（設計書 §5.12「申告フロー」・§4.5「年度更新・管理画面」）。代表者・テナント管理者だけ（§3.2 declareMembership）
// 「名簿にチェックを入れて送信するだけ」。昨年度の会員には初期チェック。新しい選手はその場で追加してから申告できる
export default async function MembershipDeclarationPage({ params, searchParams }: Props) {
  const { slug, teamId } = await params;
  const { added } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const me = { ...principal, userId: principal.userId };
  const now = new Date();
  const view = await getDeclarationView(getDb(), me, association.id, teamId, now).catch(pageErrorFrom);
  const teamPath = `/${association.slug}/teams/${view.team.id}`;
  const yearLabel = view.period ? fiscalYearLabel(view.period.year) : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={teamPath} className="underline underline-offset-2">
          ← {view.team.kind === "individual" ? "あなたの登録情報" : view.team.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{yearLabel ? `${yearLabel}も登録する人を選ぶ` : "協会員の登録"}</h1>
      {added === "1" ? <Message kind="success" title="選手を追加しました。下の一覧でチェックを入れてから送ってください" /> : null}

      {!view.target ? (
        <Message kind="info" title="このチームは協会員の登録の対象になっていません">
          大会に出るためだけのチームには申告の画面を出しません。協会員の登録をするチームなら、
          <Link href={`${teamPath}/edit`} className="font-semibold underline underline-offset-2">
            チーム情報
          </Link>
          の「協会員の登録をするチーム」を変えてください。
        </Message>
      ) : !view.period || !yearLabel ? (
        <Message kind="info" title="協会員の登録の受付はまだ始まっていません">受付が始まると、トップページの「あなたのやること」に案内が出ます。</Message>
      ) : (
        <>
          <p className="text-sm text-muted">
            受付期間: {formatDateWithWeekday(todayInTokyo(view.period.opensAt))} 〜 {formatDateWithWeekday(todayInTokyo(view.period.closesAt))}（
            {deadlineText(view.period.closesAt, now)}）
          </p>
          {view.declared ? (
            <Message kind="success" title={`${yearLabel}の申告を送りました（最終更新: ${formatDateTimeTokyo(view.declared.updatedAt)}）`}>
              {view.canSubmit ? "締切までは、チェックを変えてもう一度送ると直せます。" : null}
            </Message>
          ) : null}
          {!view.canSubmit ? (
            <Message kind="info" title={view.state === "before" ? "受付はまだ始まっていません" : "受付は終了しました"}>
              {view.state === "closed" ? (
                <>
                  直すときは
                  <Link href={`/${association.slug}/contact`} className="font-semibold underline underline-offset-2">
                    運営にお知らせください
                  </Link>
                  。年度の途中に入った人の追加の申告は、運営の画面から受け付けます。
                </>
              ) : null}
            </Message>
          ) : null}
          <DeclarationForm
            slug={association.slug}
            teamId={view.team.id}
            year={view.period.year}
            autoApprove={view.period.autoApprove}
            canSubmit={view.canSubmit}
            declared={view.declared !== null}
            players={view.players.map(toPlayerView)}
          />
          {view.canSubmit ? (
            <details className="rounded-md border border-border px-4 py-3">
              <summary className="min-h-10 cursor-pointer font-semibold">新しい選手を追加する（選手一覧にも入ります）</summary>
              <div className="pt-4">
                <PlayerForm
                  submit={{
                    url: `/api/${association.slug}/teams/${view.team.id}/members`,
                    method: "POST",
                    successPath: `${teamPath}/membership?added=1`,
                    label: "選手一覧に追加する",
                    pendingLabel: "追加しています…",
                  }}
                  initial={{ name: "", kana: "", birthDate: null, sex: "" }}
                />
              </div>
            </details>
          ) : null}
        </>
      )}
    </main>
  );
}

function toPlayerView(p: DeclarationPlayer): DeclarationPlayerView {
  return { memberId: p.memberId, name: p.name, kana: p.kana, lastYearMember: p.lastYearMember, status: p.status, checked: p.checked };
}
