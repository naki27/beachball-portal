import type { Metadata } from "next";
import Link from "next/link";
import { TeamForm } from "@/components/teams/team-form";
import { requireAssociation } from "@/lib/page/require-association";
import { requireTeam } from "@/lib/page/require-team";

type Props = { params: Promise<{ slug: string; teamId: string }> };

export const metadata: Metadata = { title: "チーム情報の変更" };

// チーム情報の変更（§5.11）。代表者とテナント管理者だけ。保存の API でも同じ検査をする
export default async function EditTeamPage({ params }: Props) {
  const { slug, teamId } = await params;
  const association = await requireAssociation(slug);
  const { team } = await requireTeam(association, teamId, "editTeam");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/teams/${team.id}`} className="underline underline-offset-2">
          ← {team.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">チーム情報の変更</h1>
      <TeamForm
        slug={association.slug}
        mode="edit"
        teamId={team.id}
        initial={{
          name: team.name,
          kana: team.kana ?? "",
          contactEmail: team.contactEmail ?? "",
          contactPhone: team.contactPhone ?? "",
          membershipRenewalTarget: team.membershipRenewalTarget,
        }}
      />
    </main>
  );
}
