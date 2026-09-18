import type { Metadata } from "next";
import { TeamForm } from "@/components/teams/team-form";
import { getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "チームで登録" };

// チームで登録（設計書 §5.11「チームの作り方」）。ログインした人なら誰でも・承認なしで作れ、作った人が代表者になる
// 個人登録（A-18）はこの画面に足す
export default async function NewTeamPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const role = resolveRole(principal, null, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "createTeam", principal));

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">チームで登録</h1>
      <p className="leading-relaxed">
        チーム名だけで登録できます。ほかの項目はあとから追加できます。登録したあなたが、このチームの代表者になります。
      </p>
      <TeamForm
        slug={association.slug}
        mode="create"
        initial={{ name: "", kana: "", contactEmail: "", contactPhone: "", membershipRenewalTarget: false }}
      />
    </main>
  );
}
