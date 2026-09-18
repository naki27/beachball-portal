import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { listMyPendingInvitations } from "@/lib/repo/invitations";
import { InvitationList } from "./invitation-list";

export const metadata: Metadata = { title: "招待" };

// 招待（設計書 §5.14「テナント管理者の招待」・§5.15）。テナントに属さない画面。確認済みのメールアドレス宛ての返事待ちだけ
export default async function InvitationsPage() {
  const principal = await getPrincipal();
  if (!principal.userId) forbidden();
  const invitations = await listMyPendingInvitations(getDb(), principal.userId);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">招待</h1>
      {invitations.length === 0 ? (
        <p className="leading-relaxed">
          返事待ちの招待はありません。招待のメールを受け取ったアドレスでログインしているか確かめてください。
        </p>
      ) : (
        <InvitationList
          invitations={invitations.map((i) => ({
            invitationId: i.invitationId,
            associationName: i.associationName,
            associationSlug: i.associationSlug,
            teamName: i.teamName,
            kind: i.kind,
            memberName: i.memberName,
            inviterName: i.inviterName,
            expiresAt: i.expiresAt.toISOString(),
          }))}
        />
      )}
    </main>
  );
}
