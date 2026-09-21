import type { Metadata } from "next";
import Link from "next/link";
import { PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { accountDeletionBlock, DELETION_BLOCK_MESSAGE } from "@/lib/account/delete-account";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { findUserProfile } from "@/lib/repo/users";
import { Message } from "@/components/ui/message";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata: Metadata = { title: "アカウントの削除" };

// アカウントの削除（設計書 §5.19）。本人だけ。代表者・管理者は理由と次の手順を出して削除させない
export default async function DeleteAccountPage() {
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const db = getDb();
  const [profile, block] = await Promise.all([
    findUserProfile(db, principal.userId),
    accountDeletionBlock(db, principal.userId),
  ]);

  return (
    <PageMain>
      <p>
        <Link href="/mypage" className="underline underline-offset-2">
          ← マイページ
        </Link>
      </p>
      <h1 className="text-2xl font-bold">アカウントの削除</h1>

      {block ? (
        <Message kind="error" title="このアカウントは削除できません">
          <p className="leading-relaxed">{DELETION_BLOCK_MESSAGE[block]}</p>
          {block === "team_admin" ? (
            <p className="leading-relaxed">
              代表者を降りるには、チームのページの「代表者」から手続きしてください。
            </p>
          ) : (
            <p className="leading-relaxed">
              <Link href="/contact" className="font-semibold underline underline-offset-2">
                お問い合わせフォーム
              </Link>
              からご連絡ください。
            </p>
          )}
        </Message>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-md border border-border px-4 py-4 leading-relaxed">
            <h2 className="font-bold">削除すると、こうなります</h2>
            <ul className="flex list-disc flex-col gap-2 pl-6">
              <li>このメールアドレスではログインできなくなります。</li>
              <li>選手として登録されている情報とアカウントの結びつきが外れます。選手の情報・申し込みは、協会のデータとして残ります。</li>
              <li>返事待ちの招待は取り消されます。</li>
              <li>すべての端末でログアウトします。</li>
              <li>メールの送信の記録とお問い合わせに残るメールアドレスは、それぞれの保存期間が過ぎるまで残ります。</li>
              <li>同じメールアドレスで、あとから新しいアカウントを作れます（前の登録とはつながりません）。</li>
            </ul>
          </div>
          <DeleteAccountForm email={profile?.email ?? ""} />
        </>
      )}
    </PageMain>
  );
}
