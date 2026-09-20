import type { Metadata } from "next";
import Link from "next/link";
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin`} className="underline underline-offset-2">
          ← 管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">削除済みデータ</h1>
      <p className="leading-relaxed">
        削除されたものは、ここから元に戻せます。完全に削除すると元に戻せません。
      </p>

      <nav aria-label="種類で絞り込み" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {TRASH_TABLE_KEYS.map((key) => (
          <Link
            key={key}
            href={`/${association.slug}/admin/trash?table=${key}`}
            aria-current={key === current ? "page" : undefined}
            className={key === current ? "font-semibold" : "underline underline-offset-2"}
          >
            {TRASH_LABEL[key]}（{counts[key]}）
          </Link>
        ))}
      </nav>

      <TrashList slug={association.slug} table={current} label={TRASH_LABEL[current]} items={items} />
    </main>
  );
}
