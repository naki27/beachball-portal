import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { listTeamsForAdmin } from "@/lib/admin/teams";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> };

export const metadata: Metadata = { title: "チーム管理" };

// チーム管理（運営）（設計書 §4.2 #16）。全チームの一覧と検索。テナント管理者だけ
export default async function AdminTeamsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q = "" } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const rows = await listTeamsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, q).catch(pageErrorFrom);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin`} className="underline underline-offset-2">
          ← 管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">チーム管理</h1>
      <form method="get" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          チーム名で探す
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="チーム名で探す"
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        />
        <button type="submit" className="bb-pressable min-h-12 shrink-0 rounded-md bg-primary px-4 font-semibold text-on-primary">
          探す
        </button>
      </form>
      <p className="text-sm text-muted">{rows.length} 件{q ? `（「${q}」で検索）` : ""}</p>
      {rows.length === 0 ? (
        <p className="leading-relaxed">該当するチームはありません。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={`/${association.slug}/admin/teams/${t.id}`}
                className="flex min-h-14 flex-col justify-center rounded-md border border-border px-4 py-2 no-underline hover:bg-surface"
              >
                <span className="font-semibold break-words">
                  {t.name}
                  {t.kind === "individual" ? <span className="ml-2 text-sm font-normal text-muted">個人登録</span> : null}
                  {t.status === "inactive" ? <span className="ml-2 text-sm font-normal text-danger">無効</span> : null}
                </span>
                <span className="text-sm text-muted">
                  代表者 {t.admins} 人・選手 {t.players} 人・協会員の登録を{t.membershipRenewalTarget ? "する" : "しない"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
