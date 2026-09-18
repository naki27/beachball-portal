import type { Metadata } from "next";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "管理" };

// 協会の管理画面の入口（中身は A-21 以降）。協会の管理者だけ。権限はサーバー側で検査する（§3.1）
export default async function AdminHome({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "manageTournaments", principal));

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{association.name}の管理</h1>
      <p className="leading-relaxed">準備中です。</p>
    </main>
  );
}
