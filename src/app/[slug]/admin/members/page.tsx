import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { searchMembersForAdmin } from "@/lib/admin/members";
import { getPrincipal } from "@/lib/auth/principal";
import { parsePlainDate } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { SEX_LABEL } from "@/lib/teams/player-input";
import { formatBirthDateLong } from "@/lib/wareki";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> };

export const metadata: Metadata = { title: "メンバー管理" };

// メンバー管理（運営）（設計書 §4.2 #15）。検索と一覧。テナント管理者は全員の生年月日を見られる（§3.2）
// 要確認の解消と 2 つの人物をまとめる画面は B-15（ここでは「確認が必要」の印だけ）
export default async function AdminMembersPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q = "" } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const rows = await searchMembersForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, q).catch(pageErrorFrom);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin`} className="underline underline-offset-2">
          ← 管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">メンバー管理</h1>
      <form method="get" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          氏名・ふりがなで探す
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="氏名・ふりがなで探す"
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        />
        <button type="submit" className="bb-pressable min-h-12 shrink-0 rounded-md bg-primary px-4 font-semibold text-on-primary">
          探す
        </button>
      </form>
      <p className="text-sm text-muted">{rows.length} 件{q ? `（「${q}」で検索）` : "（最新 100 件。確認が必要な人を先に）"}</p>
      {rows.length === 0 ? (
        <p className="leading-relaxed">該当する人はいません。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((m) => {
            const birth = parsePlainDate(m.birthDate);
            return (
              <li key={m.id}>
                <Link
                  href={`/${association.slug}/admin/members/${m.id}`}
                  className="flex min-h-14 flex-col justify-center rounded-md border border-border px-4 py-2 no-underline hover:bg-surface"
                >
                  <span className="font-semibold break-words">
                    {m.name}
                    {m.kana ? <span className="ml-2 text-sm font-normal text-muted">{m.kana}</span> : null}
                    {m.status === "needs_review" ? <span className="ml-2 rounded bg-highlight px-1 text-sm font-normal">確認が必要</span> : null}
                  </span>
                  <span className="text-sm text-muted">
                    {birth ? formatBirthDateLong(birth) : m.birthDate}・{m.age}歳・{SEX_LABEL[m.sex]}
                    {m.linked ? "・本人がログインできます" : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
