import type { Metadata } from "next";
import Link from "next/link";
import { PeriodManager, type PeriodRowView } from "@/components/memberships/period-manager";
import { getDb } from "@/db/client";
import { type AdminPeriodRow, listMembershipPeriodsForAdmin } from "@/lib/admin/membership-periods";
import { getPrincipal } from "@/lib/auth/principal";
import { fiscalYear, formatDateWithWeekday, formatPlainDate, todayInTokyo } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "会員の管理" };

// 年度更新の受付（設計書 §5.12「受付開始」・§4.2 #17）。テナント管理者だけ
// 受付を開始すると、対象チームの代表者のトップとチーム管理の画面に案内が出る。未申告の一覧・承認は D-04
export default async function AdminMembershipsPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const now = new Date();
  const periods = await listMembershipPeriodsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, now).catch(pageErrorFrom);
  const thisYear = fiscalYear(todayInTokyo(now), association.fiscalYearStartMonth);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin`} className="underline underline-offset-2">
          ← 管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">会員の管理（年度更新）</h1>
      <p className="text-sm text-muted">
        受付を開始すると、「協会員の登録をするチーム」と個人登録の代表者のトップページとチーム管理の画面に「{thisYear}年度も登録する人を選んでください」の案内が出ます。
        年度は {association.fiscalYearStartMonth} 月に始まります。
      </p>
      <PeriodManager slug={association.slug} defaultYear={String(thisYear)} periods={periods.map(toRow)} />
    </main>
  );
}

function toRow(p: AdminPeriodRow): PeriodRowView {
  return {
    id: p.id,
    year: p.year,
    opensDate: formatPlainDate(todayInTokyo(p.opensAt)),
    closesDate: formatPlainDate(todayInTokyo(p.closesAt)),
    periodText: `${formatDateWithWeekday(todayInTokyo(p.opensAt))} 〜 ${formatDateWithWeekday(todayInTokyo(p.closesAt))}`,
    autoApprove: p.autoApprove,
    state: p.state,
    targetTeams: p.targetTeams,
    declaredTeams: p.declaredTeams,
  };
}
