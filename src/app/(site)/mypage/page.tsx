import type { Metadata } from "next";
import Link from "next/link";
import { LogoutButton } from "@/components/layout/logout-button";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { loadAdminTeams, loadMyAssociations } from "@/lib/page/my-associations";
import { listMyPendingInvitations } from "@/lib/repo/invitations";
import { findUserProfile } from "@/lib/repo/users";
import { DisplayNameForm } from "./display-name-form";

export const metadata: Metadata = { title: "マイページ" };

// マイページ（設計書 §5.3）。テナントに属さない画面。協会ごとに枠を分ける（協会の列挙は §5.14「協会をまたぐ画面」）
// 協会の枠: 代表者を務めるチーム（A-14）。申込・選手として所属するチームは後のタスクで足す
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

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-bold">マイページ</h1>

      {invitations.length > 0 ? (
        <p className="rounded-md border border-border bg-info-surface px-4 py-3">
          返事待ちの招待が {invitations.length} 件あります。
          <Link href="/invitations" className="font-semibold underline underline-offset-2">
            招待を見る
          </Link>
        </p>
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
            className="flex flex-col gap-3 rounded-md border border-border px-4 py-4"
          >
            <h2 id={`association-${a.id}`} className="text-lg font-bold">
              {a.name}
            </h2>
            {a.roles.length > 0 ? <p className="text-sm text-muted">{a.roles.join("・")}</p> : null}
            {adminTeams[i].length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">代表者を務めるチーム</h3>
                <ul className="flex flex-col gap-2">
                  {adminTeams[i].map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/${a.slug}/teams/${t.id}`}
                        className="flex min-h-12 items-center rounded-md border border-border px-4 font-semibold no-underline hover:bg-surface"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="flex flex-wrap gap-x-4 gap-y-2">
              <Link href={`/${a.slug}`} className="font-semibold underline underline-offset-2">
                {a.name}のページへ
              </Link>
              <Link href={`/${a.slug}/teams/new`} className="font-semibold underline underline-offset-2">
                チームを登録する
              </Link>
            </p>
          </section>
        ))
      )}

      <section aria-labelledby="account" className="flex flex-col gap-4">
        <h2 id="account" className="text-lg font-bold">
          アカウント
        </h2>
        <p className="text-sm">
          ログインに使うメールアドレス: <span className="break-all font-semibold">{profile?.email}</span>
        </p>
        <DisplayNameForm initial={profile?.displayName ?? ""} />
        <div>
          <LogoutButton />
        </div>
      </section>
    </main>
  );
}
