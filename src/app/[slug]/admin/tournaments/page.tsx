import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader, PageMain, Toolbar } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { listTournamentsForAdmin } from "@/lib/admin/tournaments";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { entryState } from "@/lib/deadline";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { TOURNAMENT_STATUS_LABEL } from "@/lib/tournaments/tournament-input";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "大会の管理" };

// 大会の管理（設計書 §4.2 #13・§5.4）。一覧と「大会を作る」。テナント管理者だけ
export default async function AdminTournamentsPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const rows = await listTournamentsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id).catch(pageErrorFrom);
  const now = new Date();

  return (
    <PageMain width="full">
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary">
          ← 管理
        </Link>
      </p>
      <PageHeader
        title="大会の管理"
        actions={
          <Link href={`/${association.slug}/admin/tournaments/new`} className={buttonClass()}>
            大会を作る
          </Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="まだ大会がありません" description="右上の「大会を作る」から登録してください。" />
      ) : (
        <>
        <Toolbar>
          <span className="text-sm font-semibold">{rows.length} 件</span>
        </Toolbar>
        <ul className="bb-stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => {
            // 大会そのものの受付の状態（部ごとの締切は部の設定で上書きされる・§5.4）
            const state = entryState(t, { entryEndAt: null }, now);
            return (
              <li key={t.id}>
                <Link href={`/${association.slug}/admin/tournaments/${t.id}`} className="block h-full no-underline">
                  <Card interactive className="flex h-full flex-col gap-2">
                    <span className="font-bold break-words">{t.name}</span>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={t.status === "open" ? "brand" : "neutral"}>{TOURNAMENT_STATUS_LABEL[t.status]}</Badge>
                      {state === "open" ? <Badge tone="success">受け付けています</Badge> : null}
                      {state === "not_started" ? <Badge tone="neutral">受付はまだ始まっていません</Badge> : null}
                      {state === "closed" && t.status === "open" ? <Badge tone="warning">受付は終了しました</Badge> : null}
                    </span>
                    <span className="text-sm text-muted">
                      {t.eventDate ? `${t.eventDate.year}年${formatDateWithWeekday(t.eventDate)}開催` : "開催日は未定"}・部 {t.categories} つ
                    </span>
                    <span className="mt-auto pt-1 text-sm text-muted">
                      {/* 締切の瞬間（23:59:59）を日本時間の年月日に戻して出す */}
                      締切 {formatDateWithWeekday(todayInTokyo(t.entryEndAt))}まで
                    </span>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </PageMain>
  );
}
