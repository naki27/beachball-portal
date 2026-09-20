import type { Metadata } from "next";
import Link from "next/link";
import { DeclarationForm, type DeclarationPlayerView } from "@/components/memberships/declaration-form";
import { getDb } from "@/db/client";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { resolveRole, roleIncludes } from "@/lib/authz";
import { type MembershipDisplay, membershipDisplayText } from "@/lib/membership";
import { type DeclarationForm as FormData, getDeclarationForm } from "@/lib/memberships/declaration";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { deadlineText } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string; teamId: string }> };

export const metadata: Metadata = { title: "協会員の申告" };

// 年度更新の申告（設計書 §4.2 #16・§5.12「申告フロー」）。チームの代表者だけ
// 対象でないチーム・受付の期間外は 409（画面は「受け付けられません」の案内になる）
export default async function TeamMembershipPage({ params }: Props) {
  const { slug, teamId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const now = new Date();
  // テナント管理者が開いたときは代理の入力（締切後も直せる・§5.12）
  const membership = await getMembership(principal, association.id);
  const asAdmin = roleIncludes(resolveRole(principal, membership, { associationId: association.id }), "association_admin");
  const form = await getDeclarationForm(getDb(), { ...principal, userId: principal.userId }, association.id, teamId, now, { asAdmin }).catch(
    pageErrorFrom,
  );

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/teams/${form.teamId}`} className="underline underline-offset-2">
          ← {form.teamName}
        </Link>
      </p>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">
          {form.mode === "additional" ? `${form.year}年度の協会員を追加する` : `${form.year}年度も登録する人を選ぶ`}
        </h1>
        <p className="text-sm text-muted">{deadlineText(form.closesAt, now)}</p>
      </div>
      <DeclarationForm
        slug={association.slug}
        teamId={form.teamId}
        year={form.year}
        players={form.players.map((player) => toView(player, form.year))}
        submitted={form.submittedAt !== null}
        autoApprove={form.autoApprove}
        mode={form.mode}
        asAdmin={asAdmin}
      />
    </main>
  );
}

// 状態の文言は membership.ts の対応表を通す（画面ごとに書き分けない・§4.4）
const DISPLAY_OF: Record<string, MembershipDisplay> = { applied: "pending", approved: "member", declined: "not_member", expired: "not_member" };

function toView(player: FormData["players"][number], year: number): DeclarationPlayerView {
  return {
    memberId: player.memberId,
    name: player.name,
    kana: player.kana,
    wasMemberLastYear: player.wasMemberLastYear,
    locked: player.locked,
    statusText: player.status ? membershipDisplayText(DISPLAY_OF[player.status], year) : null,
    checked: player.checked,
  };
}
