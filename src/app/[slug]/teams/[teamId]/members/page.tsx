import type { Metadata } from "next";
import Link from "next/link";
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/teams/${roster.team.id}`} className="underline underline-offset-2">
          ← {roster.team.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">選手一覧</h1>
      {added === "1" ? <Message kind="success" title="選手一覧に追加しました" /> : null}
      {updated === "1" ? <Message kind="success" title="選手の情報を保存しました" /> : null}
      {roster.canManage && roster.team.kind === "team" ? (
        <p>
          <Link
            href={`/${association.slug}/teams/${roster.team.id}/members/new`}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-4 font-semibold text-on-primary no-underline"
          >
            選手を追加する
          </Link>
        </p>
      ) : null}
      <RosterList slug={association.slug} roster={roster} viewerCanManage={roster.canManage} />
    </main>
  );
}
