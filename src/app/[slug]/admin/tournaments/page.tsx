import type { Metadata } from "next";
import Link from "next/link";
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin`} className="underline underline-offset-2">
          ← 管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">大会の管理</h1>
      <Link
        href={`/${association.slug}/admin/tournaments/new`}
        className="bb-pressable flex min-h-12 items-center justify-center rounded-md bg-primary px-4 font-semibold text-on-primary no-underline"
      >
        大会を作る
      </Link>
      <p className="text-sm text-muted">{rows.length} 件</p>
      {rows.length === 0 ? (
        <p className="leading-relaxed">まだ大会がありません。「大会を作る」から登録してください。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((t) => {
            // 大会そのものの受付の状態（部ごとの締切は部の設定で上書きされる・§5.4）
            const state = entryState(t, { entryEndAt: null }, now);
            return (
              <li key={t.id}>
                <Link
                  href={`/${association.slug}/admin/tournaments/${t.id}`}
                  className="flex min-h-14 flex-col justify-center rounded-md border border-border px-4 py-2 no-underline hover:bg-surface"
                >
                  <span className="font-semibold break-words">{t.name}</span>
                  <span className="text-sm text-muted">
                    {TOURNAMENT_STATUS_LABEL[t.status]}
                    {state === "open" ? "・受け付けています" : null}
                    {state === "not_started" ? "・受付はまだ始まっていません" : null}
                    {state === "closed" && t.status === "open" ? "・受付は終了しました" : null}
                    ・{t.eventDate ? `${t.eventDate.year}年${formatDateWithWeekday(t.eventDate)}開催` : "開催日は未定"}
                    ・部 {t.categories} つ
                  </span>
                  <span className="text-sm text-muted">
                    {/* 締切の瞬間（23:59:59）を日本時間の年月日に戻して出す */}
                    締切 {formatDateWithWeekday(todayInTokyo(t.entryEndAt))}まで
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
