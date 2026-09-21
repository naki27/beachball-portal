import type { Metadata } from "next";
import Link from "next/link";
import { ContactList } from "@/components/contact/contact-list";
import { PageHeader, PageMain, Toolbar } from "@/components/ui/layout";
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
    <PageMain width="full">
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary">
          ← 管理
        </Link>
      </p>
      <PageHeader title="問い合わせ管理" />
      <Toolbar>
        <nav aria-label="絞り込み" className="flex flex-wrap gap-2">
          <Link href={`/${association.slug}/admin/contacts`} aria-current={onlyNew ? "page" : undefined} className={filterClass(onlyNew)}>
            未対応
          </Link>
          <Link
            href={`/${association.slug}/admin/contacts?status=all`}
            aria-current={onlyNew ? undefined : "page"}
            className={filterClass(!onlyNew)}
          >
            すべて
          </Link>
        </nav>
        <span className="text-sm font-semibold sm:ml-auto">{rows.length} 件</span>
      </Toolbar>
      <ContactList
        rows={rows}
        endpoint={`/api/${association.slug}/admin/contacts`}
        deleteEndpoint={`/api/${association.slug}/admin/contacts`}
      />
    </PageMain>
  );
}

// 絞り込みの選択肢。いま選んでいるものは塗りつぶし（色だけに頼らず aria-current も付ける）
function filterClass(current: boolean): string {
  return `bb-pressable inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold no-underline ${
    current ? "bg-primary text-on-primary" : "border border-border-strong bg-background hover:border-primary hover:bg-primary-soft"
  }`;
}
