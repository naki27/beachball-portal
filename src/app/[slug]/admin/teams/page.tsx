import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, PageMain, Toolbar } from "@/components/ui/layout";
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
    <PageMain width="full">
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary no-underline">
          ← 管理
        </Link>
      </p>
      <PageHeader title="チーム管理" />
      <Toolbar>
        <form method="get" className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label htmlFor="q" className="sr-only">
            チーム名で探す
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="チーム名で探す"
            className="min-h-11 w-full rounded-md border border-border-strong bg-background px-3 text-base sm:w-64"
          />
          <button type="submit" className="bb-pressable min-h-11 shrink-0 rounded-md bg-primary px-4 font-semibold text-on-primary">
            探す
          </button>
        </form>
        <span className="text-sm font-semibold sm:ml-auto">
          {rows.length} 件{q ? `（「${q}」で検索）` : ""}
        </span>
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState title="該当するチームはありません" description={q ? "ほかの言葉で探してみてください。" : undefined} />
      ) : (
        <ul className="bb-stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/${association.slug}/admin/teams/${t.id}`} className="block h-full no-underline">
                <Card interactive className="flex h-full flex-col gap-2">
                  <span className="font-bold break-words">{t.name}</span>
                  {t.kind === "individual" || t.status === "inactive" ? (
                    <span className="flex flex-wrap gap-1">
                      {t.kind === "individual" ? <Badge tone="neutral">個人登録</Badge> : null}
                      {t.status === "inactive" ? <Badge tone="danger">無効</Badge> : null}
                    </span>
                  ) : null}
                  <span className="mt-auto pt-1 text-sm text-muted">
                    代表者 {t.admins} 人・選手 {t.players} 人・協会員の登録を{t.membershipRenewalTarget ? "する" : "しない"}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  );
}
