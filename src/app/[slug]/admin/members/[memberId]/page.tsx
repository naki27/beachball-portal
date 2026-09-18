import type { Metadata } from "next";
import Link from "next/link";
import { PlayerForm } from "@/components/teams/player-form";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getMemberForAdmin } from "@/lib/admin/members";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { AdminMemberControls } from "./admin-member-controls";

type Props = { params: Promise<{ slug: string; memberId: string }>; searchParams: Promise<{ updated?: string }> };

export const metadata: Metadata = { title: "メンバー管理" };

// メンバー管理（運営）の 1 人（設計書 §4.2 #15・§5.16）: 編集、誤登録の選手一覧の行の削除、アカウントとの紐づけの解除
export default async function AdminMemberPage({ params, searchParams }: Props) {
  const { slug, memberId } = await params;
  const { updated } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const { member, linkedEmail, teams } = await getMemberForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, memberId).catch(pageErrorFrom);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin/members`} className="underline underline-offset-2">
          ← メンバー管理
        </Link>
      </p>
      {updated === "1" ? <Message kind="success" title="登録情報を保存しました" /> : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold break-words">{member.name}</h1>
        {member.status === "needs_review" ? (
          <p className="text-sm">
            <span className="rounded bg-highlight px-1">確認が必要</span>
            <span className="ml-2 text-muted">同じ人の二重登録の疑いなどがあります。解消とまとめる操作は、もう少しあとで使えるようになります</span>
          </p>
        ) : null}
      </div>

      <AdminMemberControls slug={association.slug} memberId={member.id} linkedEmail={linkedEmail} teams={teams} />

      <section aria-labelledby="admin-member-edit" className="flex flex-col gap-3">
        <h2 id="admin-member-edit" className="text-lg font-bold">
          登録情報の修正
        </h2>
        <PlayerForm
          submit={{
            url: `/api/${association.slug}/admin/members/${member.id}`,
            method: "PATCH",
            successPath: `/${association.slug}/admin/members/${member.id}?updated=1`,
            label: "保存する",
            pendingLabel: "保存しています…",
          }}
          initial={{ name: member.name, kana: member.kana ?? "", birthDate: member.birthDate, sex: member.sex }}
        />
      </section>
    </main>
  );
}
