import type { Metadata } from "next";
import Link from "next/link";
import { PeriodManager, type PeriodRowView } from "@/components/memberships/period-manager";
import { PageHeader, PageMain, Section } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { type AdminPeriodRow, listMembershipPeriodsForAdmin } from "@/lib/admin/membership-periods";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateWithWeekday, formatPlainDate, todayInTokyo } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ added?: string }> };

export const metadata: Metadata = { title: "会員の管理" };

// 年度更新の受付の一覧（設計書 §5.12「受付開始」・§4.2 #17）。テナント管理者だけ
// 受付を開始するのは別のページ（§4.3）。未申告の一覧・承認は年度ごとのページ
export default async function AdminMembershipsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { added } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const now = new Date();
  const periods = await listMembershipPeriodsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, now).catch(pageErrorFrom);

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary">
          ← 管理
        </Link>
      </p>
      <PageHeader
        title="会員の管理（年度更新）"
        lead={`年度ごとに受付を開き、代表者の申告を承認します。年度は ${association.fiscalYearStartMonth} 月に始まります。`}
      />
      <Section id="periods" title="年度ごとの受付">
        <PeriodManager slug={association.slug} periods={periods.map(toRow)} addedId={added ?? null} />
      </Section>
    </PageMain>
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
