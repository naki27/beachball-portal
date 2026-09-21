import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalList } from "@/components/memberships/approval-list";
import { PeriodManager, type PeriodRow } from "@/components/memberships/period-manager";
import { PageHeader, PageMain, Section } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { type AdminMembershipsView, getMembershipsForAdmin, getRenewalStatusForAdmin } from "@/lib/admin/memberships";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateWithWeekday, formatPlainDate, todayInTokyo } from "@/lib/date";
import { periodYearText } from "@/lib/memberships/period-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { deadlineText } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ opened?: string }> };

export const metadata: Metadata = { title: "協会員の管理" };

// 年度更新の受付（設計書 §4.2 #17・§5.12「受付開始」）。テナント管理者だけ
export default async function AdminMembershipsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { opened } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const now = new Date();
  const actor = { ...principal, userId: principal.userId };
  const view = await getMembershipsForAdmin(getDb(), actor, association.id, now).catch(pageErrorFrom);
  // 申告の状況は「いまの年度」について出す（過去の年度の締めは、受付の一覧から年度を選ぶ形にはしていない）
  const status = await getRenewalStatusForAdmin(getDb(), actor, association.id, view.currentYear, now).catch(pageErrorFrom);

  return (
    <PageMain width="wide" gap="lg">
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary no-underline">
          ← {association.name}の管理
        </Link>
      </p>
      <PageHeader
        title="協会員の管理"
        lead={`いまは${periodYearText(view.currentYear)}です（${view.fiscalYearStartMonth}月に始まる年度）。`}
      />
      <Section id="periods" title="年度更新の受付">
        <PeriodManager
          slug={association.slug}
          periods={view.periods.map((row) => toRow(row, now))}
          openedYear={opened ? Number(opened) : null}
        />
      </Section>
      <Section id="declarations" title={`${view.currentYear}年度の申告`}>
        {status.state === null ? (
          <p className="text-muted">{view.currentYear}年度の受付はまだ始めていません。</p>
        ) : (
          <ApprovalList
            slug={association.slug}
            year={status.year}
            pending={status.pending}
            additional={status.additional}
            undeclared={status.undeclared}
            approvedCount={status.approvedCount}
          />
        )}
      </Section>
    </PageMain>
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
