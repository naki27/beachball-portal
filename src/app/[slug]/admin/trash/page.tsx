import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageMain, Toolbar } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { countTrash, isTrashTable, listTrash, TRASH_LABEL, TRASH_TABLE_KEYS } from "@/lib/admin/trash";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { TrashList } from "./trash-list";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ table?: string }> };

export const metadata: Metadata = { title: "削除済みデータ" };

// 削除済みデータ（設計書 §5.16）。テナント管理者だけ。復元と、完全に削除（2 段階の確認）
export default async function AdminTrashPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { table } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const me = { ...principal, userId: principal.userId };
  const db = getDb();
  const counts = await countTrash(db, me, association.id).catch(pageErrorFrom);
  const current = table && isTrashTable(table) ? table : TRASH_TABLE_KEYS[0];
  const items = await listTrash(db, me, association.id, current).catch(pageErrorFrom);

  return (
    <PageMain width="full">
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary no-underline">
          ← 管理
        </Link>
      </p>
      <PageHeader title="削除済みデータ" lead="削除されたものは、ここから元に戻せます。完全に削除すると元に戻せません。" />

      <Toolbar>
        <nav aria-label="種類で絞り込み" className="flex flex-wrap gap-2">
          {TRASH_TABLE_KEYS.map((key) => (
            <Link
              key={key}
              href={`/${association.slug}/admin/trash?table=${key}`}
              aria-current={key === current ? "page" : undefined}
              className={`bb-pressable inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold no-underline ${
                key === current
                  ? "bg-primary text-on-primary"
                  : "border border-border-strong bg-background hover:border-primary hover:bg-primary-soft"
              }`}
            >
              {TRASH_LABEL[key]}（{counts[key]}）
            </Link>
          ))}
        </nav>
      </Toolbar>

      <TrashList slug={association.slug} table={current} label={TRASH_LABEL[current]} items={items} />
    </PageMain>
  );
}
