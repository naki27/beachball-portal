import type { Metadata } from "next";
import Link from "next/link";
import { TeamStatusControls } from "@/components/teams/team-status-controls";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { can } from "@/lib/authz";
import { parsePlainDate } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { requireAssociation } from "@/lib/page/require-association";
import { requireTeam } from "@/lib/page/require-team";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { findTeam } from "@/lib/repo/teams";
import { SEX_LABEL } from "@/lib/teams/player-input";
import { getRoster } from "@/lib/teams/roster";
import { formatBirthDateLong } from "@/lib/wareki";

type Props = {
  params: Promise<{ slug: string; teamId: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
};

// タブの題名: チームは「チーム」、個人登録は「登録情報」（画面上は「チーム」と呼ばない・§4.4）
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, teamId } = await params;
  const association = await requireAssociation(slug);
  const team = isUuid(teamId) ? await withTenant(association.id, (tx) => findTeam(tx, association.id, teamId)) : null;
  return { title: team?.kind === "individual" ? "登録情報" : "チーム" };
}

// チームのページ（設計書 §5.11）。チームの選手・代表者・テナント管理者が見られる（§3.2）。連絡先は代表者から
// 個人登録（kind = individual）では「あなたの登録情報」として本人の情報を出す。申込は B 系のタスクで足す
export default async function TeamPage({ params, searchParams }: Props) {
  const { slug, teamId } = await params;
  const { created, updated } = await searchParams;
  const association = await requireAssociation(slug);
  const { team, role, principal } = await requireTeam(association, teamId, "viewOwnTeamRoster");
  const canEdit = can(role, "editTeam");

  if (team.kind === "individual") {
    const roster = await getRoster(getDb(), { ...principal, userId: principal.userId as string }, association.id, teamId).catch(pageErrorFrom);
    const me = roster.items[0];
    const birth = me?.personal ? parsePlainDate(me.personal.birthDate) : null;
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
        {created === "1" ? <Message kind="success" title="個人で登録しました" /> : null}
        {updated === "1" ? <Message kind="success" title="登録情報を保存しました" /> : null}
        <h1 className="text-2xl font-bold">あなたの登録情報</h1>
        {me ? (
          <div className="flex flex-col gap-1 rounded-md border border-border px-4 py-3">
            <p className="text-lg font-semibold break-words">{me.name}</p>
            {me.kana ? <p className="text-sm text-muted">{me.kana}</p> : null}
            {me.personal && birth ? (
              <p className="text-sm">
                {formatBirthDateLong(birth)}・{me.personal.age}歳・{SEX_LABEL[me.personal.sex]}
              </p>
            ) : null}
            {roster.canManage ? (
              <p className="pt-2">
                <Link href={`/${association.slug}/teams/${team.id}/members/${me.teamMemberId}/edit`} className="font-semibold underline underline-offset-2">
                  登録情報を修正する
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm text-muted">協会員の登録（毎年の更新）の対象です。大会に出るときは、チームを作るか、ほかのチームの申し込みに選手として入れてもらってください。</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      {created === "1" ? <Message kind="success" title="チームを登録しました。あなたがこのチームの代表者です" /> : null}
      {updated === "1" ? <Message kind="success" title="チーム情報を保存しました" /> : null}
      {team.status === "inactive" ? (
        <Message kind="info" title="このチームは無効になっています">
          大会に申し込めず、招待もできません。代表者は「有効に戻す」でいつでも戻せます。
        </Message>
      ) : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold break-words">{team.name}</h1>
        {team.kana ? <p className="text-sm text-muted">{team.kana}</p> : null}
      </div>

      <p>
        <Link
          href={`/${association.slug}/teams/${team.id}/members`}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-border px-4 font-semibold no-underline"
        >
          選手一覧
        </Link>
      </p>

      <section aria-labelledby="team-info" className="flex flex-col gap-3">
        <h2 id="team-info" className="text-lg font-bold">
          チーム情報
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted">協会員の登録</dt>
          <dd>{team.membershipRenewalTarget ? "するチーム" : "しないチーム"}</dd>
          {can(role, "viewTeamContact") ? (
            <>
              <dt className="text-muted">メール</dt>
              <dd className="break-all">{team.contactEmail ?? "未登録"}</dd>
              <dt className="text-muted">電話</dt>
              <dd>{team.contactPhone ?? "未登録"}</dd>
            </>
          ) : null}
        </dl>
        {canEdit ? (
          <p className="flex flex-wrap gap-x-4 gap-y-2">
            <Link href={`/${association.slug}/teams/${team.id}/edit`} className="font-semibold underline underline-offset-2">
              チーム情報を変える
            </Link>
            <Link href={`/${association.slug}/teams/${team.id}/admins`} className="font-semibold underline underline-offset-2">
              代表者
            </Link>
          </p>
        ) : null}
      </section>
      {canEdit ? <TeamStatusControls slug={association.slug} teamId={team.id} status={team.status} /> : null}
    </main>
  );
}
