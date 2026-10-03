import type { Metadata } from "next";
import Link from "next/link";
import { PeriodNewForm } from "@/components/memberships/period-new-form";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { listMembershipPeriodsForAdmin } from "@/lib/admin/membership-periods";
import { getPrincipal } from "@/lib/auth/principal";
import { fiscalYear, todayInTokyo } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "受付を開始する" };

// 年度更新の受付を開始するページ（設計書 §5.12「受付開始」・§4.3「一覧と登録はページを分ける」）。テナント管理者だけ
// 一覧と同じ読み込みを通すので、権限がないときはここでも 403 になる
export default async function NewMembershipPeriodPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const now = new Date();
  await listMembershipPeriodsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, now).catch(pageErrorFrom);
  const thisYear = fiscalYear(todayInTokyo(now), association.fiscalYearStartMonth);

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/admin/memberships`} className="bb-link text-primary">
          ← 会員の管理
        </Link>
      </p>
      <PageHeader
        title="受付を開始する"
        lead={`受付を開始すると、「協会員の登録をするチーム」と個人登録の代表者に「${thisYear}年度も登録する人を選んでください」の案内が出ます。`}
      />
      <PeriodNewForm slug={association.slug} defaultYear={String(thisYear)} />
    </PageMain>
  );
}
