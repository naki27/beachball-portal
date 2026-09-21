import type { Metadata } from "next";
import Link from "next/link";
import { TeamForm } from "@/components/teams/team-form";
import { PageMain } from "@/components/ui/layout";
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
    <PageMain>
      <p>
        <Link href={`/${association.slug}/teams/${team.id}`} className="bb-link">
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
    </PageMain>
  );
}
