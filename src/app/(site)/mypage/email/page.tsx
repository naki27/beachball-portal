import type { Metadata } from "next";
import Link from "next/link";
import { PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { findUserProfile } from "@/lib/repo/users";
import { listMyPendingInvitations } from "@/lib/repo/invitations";
import { EmailChangeForm } from "./email-change-form";

export const metadata: Metadata = { title: "メールアドレスの変更" };

// メールアドレスの変更（設計書 §5.19）。本人だけ。新しいアドレスに確認番号 → 番号で確定 → 古いアドレスに知らせ
export default async function EmailChangePage() {
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const db = getDb();
  const [profile, invitations] = await Promise.all([
    findUserProfile(db, principal.userId),
    listMyPendingInvitations(db, principal.userId),
  ]);

  return (
    <PageMain>
      <p>
        <Link href="/mypage" className="underline underline-offset-2">
          ← マイページ
        </Link>
      </p>
      <h1 className="text-2xl font-bold">メールアドレスの変更</h1>
      <p className="leading-relaxed">
        いまのメールアドレス: <span className="break-all font-semibold">{profile?.email}</span>
      </p>
      <p className="leading-relaxed">
        新しいメールアドレスに確認番号をお送りします。番号を入れると変更が確定し、古いメールアドレスに知らせが届きます。
      </p>
      {invitations.length > 0 ? (
        <p className="rounded-md border border-border bg-info-surface px-4 py-3 leading-relaxed">
          返事待ちの招待が {invitations.length} 件あります。招待はメールアドレス宛てに届くため、
          <Link href="/invitations" className="font-semibold underline underline-offset-2">
            変更の前に返事をしてください
          </Link>
          。
        </p>
      ) : null}
      <EmailChangeForm />
    </PageMain>
  );
}
