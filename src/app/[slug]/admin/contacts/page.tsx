import type { Metadata } from "next";
import Link from "next/link";
import { ContactList } from "@/components/contact/contact-list";
import { getDb } from "@/db/client";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { listAssociationContacts } from "@/lib/contact-admin";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> };

export const metadata: Metadata = { title: "問い合わせ管理" };

// 問い合わせ管理（設計書 §5.10）。その協会宛ての問い合わせ。テナント管理者だけ
export default async function AssociationContactsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { status } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "manageContacts", principal));

  const onlyNew = status !== "all";
  const rows = await listAssociationContacts(getDb(), association.id, onlyNew ? { status: "new" } : {});

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin`} className="underline underline-offset-2">
          ← 管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">問い合わせ管理</h1>
      <nav aria-label="絞り込み" className="flex gap-4 text-sm">
        <Link
          href={`/${association.slug}/admin/contacts`}
          aria-current={onlyNew ? "page" : undefined}
          className={onlyNew ? "font-semibold" : "underline underline-offset-2"}
        >
          未対応
        </Link>
        <Link
          href={`/${association.slug}/admin/contacts?status=all`}
          aria-current={onlyNew ? undefined : "page"}
          className={onlyNew ? "underline underline-offset-2" : "font-semibold"}
        >
          すべて
        </Link>
      </nav>
      <p className="text-sm text-muted">{rows.length} 件</p>
      <ContactList
        rows={rows}
        endpoint={`/api/${association.slug}/admin/contacts`}
        deleteEndpoint={`/api/${association.slug}/admin/contacts`}
      />
    </main>
  );
}
