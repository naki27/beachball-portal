import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { requireTeam } from "@/lib/page/require-team";
import { getTeamAdmins } from "@/lib/teams/admins";
import { AdminManagement } from "./admin-management";

type Props = { params: Promise<{ slug: string; teamId: string }> };

export const metadata: Metadata = { title: "代表者" };

// チームの代表者（設計書 §5.11「代表者の委譲」）。代表者とテナント管理者だけ
// 追加は「選手として紐づいている人」から選ぶか、メールアドレスで招待する（本人が承諾して代表者になる）。最後の 1 人は外せない
export default async function TeamAdminsPage({ params }: Props) {
  const { slug, teamId } = await params;
  const association = await requireAssociation(slug);
  const { team, principal } = await requireTeam(association, teamId, "manageTeamAdmins");
  if (!principal.userId) denyPage();
  const view = await getTeamAdmins(getDb(), { ...principal, userId: principal.userId }, association.id, teamId).catch(pageErrorFrom);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/teams/${team.id}`} className="underline underline-offset-2">
          ← {team.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">代表者</h1>
      <p className="text-sm text-muted">
        代表者は、選手一覧の編集・大会への申し込み・協会員の登録の申告ができます。追加した人は、本人が「参加する」を押すと代表者になります。
      </p>
      <AdminManagement
        slug={association.slug}
        teamId={team.id}
        teamStatus={team.status}
        myUserId={principal.userId}
        admins={view.admins.map((a) => ({ userId: a.userId, email: a.email, displayName: a.displayName }))}
        invitations={view.invitations}
        candidates={view.candidates}
      />
    </main>
  );
}
