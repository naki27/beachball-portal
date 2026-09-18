import type { Metadata } from "next";
import Link from "next/link";
import { TeamForm } from "@/components/teams/team-form";
import { TeamStatusControls } from "@/components/teams/team-status-controls";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getTeamForAdmin } from "@/lib/admin/teams";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { AdminTeamControls } from "./admin-team-controls";

type Props = { params: Promise<{ slug: string; teamId: string }>; searchParams: Promise<{ updated?: string }> };

export const metadata: Metadata = { title: "チーム管理" };

// チーム管理（運営）の 1 チーム（設計書 §4.2 #16）: 編集・代表者の付け替え・協会員の登録をするチームか・無効化・削除
export default async function AdminTeamPage({ params, searchParams }: Props) {
  const { slug, teamId } = await params;
  const { updated } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const { team, admins, players } = await getTeamForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, teamId).catch(pageErrorFrom);
  const individual = team.kind === "individual";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin/teams`} className="underline underline-offset-2">
          ← チーム管理
        </Link>
      </p>
      {updated === "1" ? <Message kind="success" title="チーム情報を保存しました" /> : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold break-words">{team.name}</h1>
        <p className="text-sm text-muted">
          {individual ? "個人登録・" : ""}
          {team.status === "inactive" ? "無効・" : ""}選手 {players} 人・
          <Link href={`/${association.slug}/teams/${team.id}/members`} className="underline underline-offset-2">
            選手一覧を見る
          </Link>
        </p>
      </div>

      <AdminTeamControls
        slug={association.slug}
        teamId={team.id}
        admins={admins.map((a) => ({ userId: a.userId, email: a.email, displayName: a.displayName }))}
      />

      {!individual ? <TeamStatusControls slug={association.slug} teamId={team.id} status={team.status} /> : null}

      {!individual ? (
        <section aria-labelledby="admin-team-edit" className="flex flex-col gap-3">
          <h2 id="admin-team-edit" className="text-lg font-bold">
            チーム情報
          </h2>
          <TeamForm
            slug={association.slug}
            mode="edit"
            teamId={team.id}
            successPath={`/${association.slug}/admin/teams/${team.id}?updated=1`}
            initial={{
              name: team.name,
              kana: team.kana ?? "",
              contactEmail: team.contactEmail ?? "",
              contactPhone: team.contactPhone ?? "",
              membershipRenewalTarget: team.membershipRenewalTarget,
            }}
          />
        </section>
      ) : null}
    </main>
  );
}
