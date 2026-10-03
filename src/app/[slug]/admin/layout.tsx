import type { ReactNode } from "react";
import { AdminNav } from "@/components/layout/admin-nav";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { children: ReactNode; params: Promise<{ slug: string }> };

// 管理画面の共通の枠（設計書 §4.3 v0.9.6・ADR 0028）。PC は左に案内、狭い画面は本文の上に並べる
// **ここで協会の管理者かを検査して 403 を返す**（ADR 0029）。layout は loading.tsx の外側なので、
// 骨組みを出しても 403 のステータスがそのまま返る。各ページ・各 API の検査はそのまま残す（二重に見る・§3.1）
export default async function AdminLayout({ children, params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "manageTournaments", principal));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row">
      <AdminNav slug={association.slug} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
