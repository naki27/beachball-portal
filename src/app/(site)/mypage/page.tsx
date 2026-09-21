import type { Metadata } from "next";
import Link from "next/link";
import { MyEntryList } from "@/components/entries/my-entry-list";
import { LogoutButton } from "@/components/layout/logout-button";
import { Card, PageHeader, PageMain, Section } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { listMyEntries } from "@/lib/entries/my-entries";
import { denyPage } from "@/lib/page/forbidden";
import { loadAdminTeams, loadIndividualRegistration, loadMyAssociations, loadPlayerTeams } from "@/lib/page/my-associations";
import { getMyPerson } from "@/lib/teams/self";
import { UnlinkButton } from "./unlink-button";
import { listMyPendingInvitations } from "@/lib/repo/invitations";
import { findUserProfile } from "@/lib/repo/users";
import { DisplayNameForm } from "./display-name-form";

export const metadata: Metadata = { title: "マイページ" };

// マイページ（設計書 §5.3）。テナントに属さない画面。協会ごとに枠を分ける（協会の列挙は §5.14「協会をまたぐ画面」）
// 協会の枠: 代表者を務めるチーム・選手として所属するチームと、代表者として操作できる申込・選手として出る申込
export default async function MyPage() {
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const db = getDb();
  const [profile, associations, invitations] = await Promise.all([
    findUserProfile(db, principal.userId),
    loadMyAssociations(principal),
    listMyPendingInvitations(db, principal.userId),
  ]);
  const adminTeams = await Promise.all(associations.map((a) => loadAdminTeams(principal, a.id)));
  const individuals = await Promise.all(associations.map((a) => loadIndividualRegistration(principal, a.id)));
  const playerTeams = await Promise.all(associations.map((a) => loadPlayerTeams(principal, a.id)));
  const me = { ...principal, userId: principal.userId };
  const persons = await Promise.all(associations.map((a) => getMyPerson(db, me, a.id)));
  const entries = await Promise.all(associations.map((a) => listMyEntries(db, principal, a.id)));
  const now = new Date();

  return (
    <PageMain width="wide" gap="lg">
      <PageHeader title="マイページ" />

      {invitations.length > 0 ? (
        <Card tone="accent">
          返事待ちの招待が {invitations.length} 件あります。
          <Link href="/invitations" className="bb-link font-semibold text-primary no-underline">
            招待を見る
          </Link>
        </Card>
      ) : null}

      {associations.length === 0 ? (
        <p className="leading-relaxed">
          まだどの協会にも登録していません。協会から案内されたページを開いて、チームや選手を登録してください。
        </p>
      ) : (
        associations.map((a, i) => (
          <section
            key={a.id}
            aria-labelledby={`association-${a.id}`}
            className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-sm sm:p-5"
          >
            <h2 id={`association-${a.id}`} className="text-lg font-bold">
              {a.name}
            </h2>
            {a.roles.length > 0 ? <p className="text-sm text-muted">{a.roles.join("・")}</p> : null}
            {individuals[i] ? (
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">あなたの登録情報</h3>
                <Link
                  href={`/${a.slug}/teams/${individuals[i].teamId}`}
                  className="bb-pressable flex min-h-12 items-center rounded-md border border-border-strong px-4 font-semibold no-underline hover:border-primary hover:bg-primary-soft"
                >
                  {individuals[i].person?.name ?? "登録情報を見る"}
                </Link>
              </div>
            ) : null}
            {adminTeams[i].length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">代表者を務めるチーム</h3>
                <ul className="grid gap-2 md:grid-cols-2">
                  {adminTeams[i].map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/${a.slug}/teams/${t.id}`}
                        className="bb-pressable flex min-h-12 items-center rounded-md border border-border-strong px-4 font-semibold no-underline hover:border-primary hover:bg-primary-soft"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {playerTeams[i].length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">選手として所属するチーム</h3>
                <ul className="grid gap-2 md:grid-cols-2">
                  {playerTeams[i].map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/${a.slug}/teams/${t.id}/members`}
                        className="bb-pressable flex min-h-12 items-center rounded-md border border-border-strong px-4 font-semibold no-underline hover:border-primary hover:bg-primary-soft"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted">情報の修正はチームの代表者だけができます。代表者に直接お伝えください</p>
              </div>
            ) : null}
            <MyEntryList slug={a.slug} title="代表者として操作できる申し込み" entries={entries[i].managed} now={now} />
            <MyEntryList slug={a.slug} title="選手として出る申し込み" entries={entries[i].asPlayer} now={now} />
            {persons[i] && !individuals[i] ? <UnlinkButton slug={a.slug} memberId={persons[i].memberId} personName={persons[i].name} /> : null}
            <p className="flex flex-wrap gap-x-4 gap-y-2">
              <Link href={`/${a.slug}`} className="bb-link inline-flex min-h-11 items-center font-semibold text-primary no-underline">
                {a.name}のページへ
              </Link>
              <Link href={`/${a.slug}/teams/new`} className="bb-link inline-flex min-h-11 items-center font-semibold text-primary no-underline">
                チームを登録する
              </Link>
              {!individuals[i] ? (
                <Link href={`/${a.slug}/teams/new?kind=individual`} className="bb-link inline-flex min-h-11 items-center font-semibold text-primary no-underline">
                  個人で登録する
                </Link>
              ) : null}
            </p>
          </section>
        ))
      )}

      <Section id="account" title="アカウント">
        <p className="text-sm">
          ログインに使うメールアドレス: <span className="break-all font-semibold">{profile?.email}</span>
        </p>
        <p>
          <Link href="/mypage/email" className="bb-link inline-flex min-h-11 items-center font-semibold text-primary no-underline">
            メールアドレスを変更する
          </Link>
        </p>
        <DisplayNameForm initial={profile?.displayName ?? ""} />
        <div>
          <LogoutButton />
        </div>
        <p>
          <Link href="/mypage/delete" className="text-sm underline underline-offset-2">
            アカウントを削除する
          </Link>
        </p>
      </Section>
    </PageMain>
  );
}
