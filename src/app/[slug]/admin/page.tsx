import type { Metadata } from "next";
import Link from "next/link";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "管理" };

// 協会の管理画面の入口。協会の管理者だけ。権限はサーバー側で検査する（§3.1）
// 1a の分: チーム管理・メンバー管理。大会・会員・問い合わせなどは後のタスクで足す
export default async function AdminHome({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "manageTournaments", principal));

  const itemClass = "flex min-h-14 items-center rounded-md border border-border px-4 font-semibold no-underline hover:bg-surface";
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{association.name}の管理</h1>
      <nav aria-label="管理の項目" className="flex flex-col gap-3">
        <Link href={`/${association.slug}/admin/teams`} className={itemClass}>
          チーム管理
        </Link>
        <Link href={`/${association.slug}/admin/members`} className={itemClass}>
          メンバー管理
        </Link>
      </nav>
      <p className="text-sm text-muted">大会・会員・問い合わせの管理は準備中です。</p>
    </main>
  );
}
