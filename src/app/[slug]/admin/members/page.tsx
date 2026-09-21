import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, PageMain, Toolbar } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { searchMembersForAdmin } from "@/lib/admin/members";
import { listNeedsReview } from "@/lib/admin/merge-members";
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
// 「確認が必要」の一覧から、解消とまとめる画面（§5.8）へ進む
export default async function AdminMembersPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q = "" } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const me = { ...principal, userId: principal.userId };
  const rows = await searchMembersForAdmin(getDb(), me, association.id, q).catch(pageErrorFrom);
  const needsReview = await listNeedsReview(getDb(), me, association.id).catch(pageErrorFrom);

  return (
    <PageMain width="full">
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary no-underline">
          ← 管理
        </Link>
      </p>
      <PageHeader title="メンバー管理" />
      {needsReview.length > 0 ? (
        <section aria-labelledby="needs-review" className="flex flex-col gap-2 rounded-lg border border-warning bg-warning-surface p-4">
          <h2 id="needs-review" className="text-lg font-bold">
            確認が必要（{needsReview.length} 件）
          </h2>
          <p className="text-sm text-muted">同じ人が二重に登録されている疑いがあります。開いて、別の人か・同じ人かを選んでください。</p>
          <ul className="flex flex-col gap-1">
            {needsReview.map((m) => (
              <li key={m.id}>
                <Link href={`/${association.slug}/admin/members/${m.id}/review`} className="bb-link font-semibold text-primary no-underline">
                  {m.name}
                </Link>
                <span className="ml-2 text-sm text-muted break-words">
                  {m.birthDate}・{m.teamNames.length > 0 ? m.teamNames.join("・") : "チームなし"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Toolbar>
        <form method="get" className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label htmlFor="q" className="sr-only">
            氏名・ふりがなで探す
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="氏名・ふりがなで探す"
            className="min-h-11 w-full rounded-md border border-border-strong bg-background px-3 text-base sm:w-64"
          />
          <button type="submit" className="bb-pressable min-h-11 shrink-0 rounded-md bg-primary px-4 font-semibold text-on-primary">
            探す
          </button>
        </form>
        <span className="text-sm font-semibold sm:ml-auto">
          {rows.length} 件{q ? `（「${q}」で検索）` : "（最新 100 件。確認が必要な人を先に）"}
        </span>
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState title="該当する人はいません" description={q ? "ほかの言葉で探してみてください。" : undefined} />
      ) : (
        <ul className="bb-stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((m) => {
            const birth = parsePlainDate(m.birthDate);
            return (
              <li key={m.id}>
                <Link href={`/${association.slug}/admin/members/${m.id}`} className="block h-full no-underline">
                  <Card interactive className="flex h-full flex-col gap-1">
                    <span className="font-bold break-words">
                      {m.name}
                      {m.kana ? <span className="ml-2 text-sm font-normal text-muted">{m.kana}</span> : null}
                    </span>
                    {m.status === "needs_review" ? (
                      <span>
                        <Badge tone="warning">確認が必要</Badge>
                      </span>
                    ) : null}
                    <span className="mt-auto pt-1 text-sm text-muted">
                      {birth ? formatBirthDateLong(birth) : m.birthDate}・{m.age}歳・{SEX_LABEL[m.sex]}
                      {m.linked ? "・本人がログインできます" : ""}
                    </span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageMain>
  );
}
