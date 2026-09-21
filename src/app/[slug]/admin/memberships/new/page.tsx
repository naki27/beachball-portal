import type { Metadata } from "next";
import Link from "next/link";
import { PeriodOpenForm } from "@/components/memberships/period-open-form";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { getMembershipsForAdmin } from "@/lib/admin/memberships";
import { getPrincipal } from "@/lib/auth/principal";
import { periodYearText } from "@/lib/memberships/period-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "受付を始める" };

// 年度更新の受付を始めるページ（設計書 §5.12・§4.3「一覧と登録はページを分ける」）。テナント管理者だけ
export default async function NewMembershipPeriodPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const view = await getMembershipsForAdmin(
    getDb(),
    { ...principal, userId: principal.userId },
    association.id,
    new Date(),
  ).catch(pageErrorFrom);

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/admin/memberships`} className="bb-link text-primary">
          ← 協会員の管理
        </Link>
      </p>
      <PageHeader title="受付を始める" lead={`いまは${periodYearText(view.currentYear)}です。`} />
      <PeriodOpenForm slug={association.slug} defaultYear={view.currentYear} />
    </PageMain>
  );
}
