import type { Metadata } from "next";
import Link from "next/link";
import { PeriodManager, type PeriodRow } from "@/components/memberships/period-manager";
import { getDb } from "@/db/client";
import { type AdminMembershipsView, getMembershipsForAdmin } from "@/lib/admin/memberships";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateWithWeekday, formatPlainDate, todayInTokyo } from "@/lib/date";
import { periodYearText } from "@/lib/memberships/period-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { deadlineText } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "協会員の管理" };

// 年度更新の受付（設計書 §4.2 #17・§5.12「受付開始」）。テナント管理者だけ
export default async function AdminMembershipsPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const now = new Date();
  const view = await getMembershipsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, now).catch(pageErrorFrom);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin`} className="underline underline-offset-2">
          ← {association.name}の管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">協会員の管理</h1>
      <p className="text-sm text-muted">いまは{periodYearText(view.currentYear)}です（{view.fiscalYearStartMonth}月に始まる年度）。</p>
      <PeriodManager slug={association.slug} periods={view.periods.map((row) => toRow(row, now))} nextYear={view.currentYear} />
    </main>
  );
}

const STATE_TEXT = { not_started: "受付の開始前", open: "受付中", closed: "受付は終了" } as const;

function toRow(period: AdminMembershipsView["periods"][number], now: Date): PeriodRow {
  const opens = todayInTokyo(period.opensAt);
  return {
    year: period.year,
    yearText: periodYearText(period.year),
    opensDate: formatPlainDate(opens),
    closesDate: formatPlainDate(todayInTokyo(period.closesAt)),
    autoApprove: period.autoApprove,
    periodText: `${opens.year}年${formatDateWithWeekday(opens)}から　${deadlineText(period.closesAt, now)}`,
    stateText: STATE_TEXT[period.state],
    targetTeams: period.targetTeams,
    declaredTeams: period.declaredTeams,
  };
}
