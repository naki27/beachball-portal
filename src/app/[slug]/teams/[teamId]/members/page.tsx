import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { getRoster } from "@/lib/teams/roster";
import { RosterList } from "./roster-list";

type Props = {
  params: Promise<{ slug: string; teamId: string }>;
  searchParams: Promise<{ added?: string; updated?: string }>;
};

export const metadata: Metadata = { title: "選手一覧" };

// 選手一覧（設計書 §5.11）。選手・代表者・テナント管理者。選手にはほかの人の生年月日・年齢・性別を出さない（§3.2）
export default async function RosterPage({ params, searchParams }: Props) {
  const { slug, teamId } = await params;
  const { added, updated } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const roster = await getRoster(getDb(), { ...principal, userId: principal.userId }, association.id, teamId).catch(pageErrorFrom);

  return (
    <PageMain width="wide">
      <p>
        <Link href={`/${association.slug}/teams/${roster.team.id}`} className="bb-link text-primary">
          ← {roster.team.name}
        </Link>
      </p>
      <PageHeader
        eyebrow={roster.team.name}
        title="選手一覧"
        actions={
          roster.canManage && roster.team.kind === "team" ? (
            <Link href={`/${association.slug}/teams/${roster.team.id}/members/new`} className={buttonClass()}>
              選手を追加する
            </Link>
          ) : null
        }
      />
      {added === "1" ? <Message kind="success" title="選手一覧に追加しました" /> : null}
      {updated === "1" ? <Message kind="success" title="選手の情報を保存しました" /> : null}
      <RosterList slug={association.slug} roster={roster} viewerCanManage={roster.canManage} />
    </PageMain>
  );
}
