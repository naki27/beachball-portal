import type { ReactNode } from "react";
import { AdminNav } from "@/components/layout/admin-nav";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { can, resolveRole } from "@/lib/authz";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { children: ReactNode; params: Promise<{ slug: string }> };

// 管理画面の共通の枠（設計書 §4.3 v0.9.6・ADR 0028）。PC は左に案内、狭い画面は本文の上に並べる
// **ここは見た目だけ**。実際の権限の判定は各ページ・各 API が行う（§3.1）。
// 管理者でない人には案内を出さない（403 の画面に管理の項目を出さないため）
export default async function AdminLayout({ children, params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id });
  const isAdmin = can(role, "manageTournaments");

  if (!isAdmin) return <>{children}</>;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row">
      <AdminNav slug={association.slug} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
