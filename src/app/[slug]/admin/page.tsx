import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, PageMain } from "@/components/ui/layout";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "管理" };

// 協会の管理画面の入口。協会の管理者だけ。権限はサーバー側で検査する（§3.1）
// 大会（B-04 / B-05）・資料（C-01）・協会員の年度更新（D-02）まで。並びは使う頻度の順
export default async function AdminHome({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "manageTournaments", principal));

  return (
    <PageMain width="full">
      <PageHeader title={`${association.name}の管理`} lead="大会・チーム・協会員の登録をまとめて行えます。" />
      <nav aria-label="管理の入口" className="bb-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Link href={`/${association.slug}/admin/tournaments`} className="block h-full no-underline">
          <Card interactive className="flex h-full flex-col gap-1">
            <span className="text-lg font-bold">大会の管理</span>
            <span className="text-sm text-muted">大会を作る・直す。部・締切・定員・資料</span>
          </Card>
        </Link>
        <Link href={`/${association.slug}/admin/teams`} className="block h-full no-underline">
          <Card interactive className="flex h-full flex-col gap-1">
            <span className="text-lg font-bold">チーム管理</span>
            <span className="text-sm text-muted">チームの一覧、代表者の付け替え、無効化</span>
          </Card>
        </Link>
        <Link href={`/${association.slug}/admin/members`} className="block h-full no-underline">
          <Card interactive className="flex h-full flex-col gap-1">
            <span className="text-lg font-bold">メンバー管理</span>
            <span className="text-sm text-muted">人物の検索・修正、要確認の解消</span>
          </Card>
        </Link>
        <Link href={`/${association.slug}/admin/memberships`} className="block h-full no-underline">
          <Card interactive className="flex h-full flex-col gap-1">
            <span className="text-lg font-bold">協会員の管理（年度更新）</span>
            <span className="text-sm text-muted">受付の開始、申告の承認</span>
          </Card>
        </Link>
        <Link href={`/${association.slug}/admin/contacts`} className="block h-full no-underline">
          <Card interactive className="flex h-full flex-col gap-1">
            <span className="text-lg font-bold">問い合わせ管理</span>
            <span className="text-sm text-muted">届いた問い合わせの確認</span>
          </Card>
        </Link>
        <Link href={`/${association.slug}/admin/trash`} className="block h-full no-underline">
          <Card interactive className="flex h-full flex-col gap-1">
            <span className="text-lg font-bold">削除済みデータ</span>
            <span className="text-sm text-muted">消したものの復元・完全な削除</span>
          </Card>
        </Link>
        <Link href={`/${association.slug}/admin/association`} className="block h-full no-underline">
          <Card interactive className="flex h-full flex-col gap-1">
            <span className="text-lg font-bold">協会の設定（よく使う部門・個人での登録）</span>
            <span className="text-sm text-muted">大会に足す部のひな形・個人での登録の受け付け</span>
          </Card>
        </Link>
      </nav>
    </PageMain>
  );
}
