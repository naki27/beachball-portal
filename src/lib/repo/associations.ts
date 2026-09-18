import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { associations } from "@/db/schema";
import type { Tx } from "@/db/tenant";

export type Association = typeof associations.$inferSelect;

// associations はテナントに属さない表なので、withTenant の外（Db）からも読める
type Reader = Db | Tx;

export async function findAssociationById(db: Reader, id: string): Promise<Association | null> {
  const [row] = await db.select().from(associations).where(eq(associations.id, id)).limit(1);
  return row ?? null;
}

export type SlugHit = {
  associationId: string;
  currentSlug: string;
  // true = 旧スラッグで当たった（新しいスラッグへ 308 する・§5.14）
  redirected: boolean;
};

// 現行のスラッグ → 旧スラッグの順に探す。旧スラッグ（association_slug_history）は RLS の下にあるので
// SECURITY DEFINER 関数 resolve_association_slug() で読む（docs/adr/0003）
export async function resolveAssociationSlug(db: Reader, slug: string): Promise<SlugHit | null> {
  const result = await db.execute<{ association_id: string; slug: string; redirected: boolean }>(
    sql`select association_id, slug, redirected from resolve_association_slug(${slug})`,
  );
  const row = result.rows[0];
  return row ? { associationId: row.association_id, currentSlug: row.slug, redirected: row.redirected } : null;
}

export type AssociationLink = { id: string; name: string; slug: string };

// ログイン中の人が役割（協会の管理者・チームの代表者・選手）を持つ協会（設計書 §5.14「協会をまたぐ画面」）
// SECURITY DEFINER 関数 my_association_ids() が app.user_id（SET LOCAL）の人の分だけを返す。名前の順
export async function listMyAssociations(db: Reader, userId: string): Promise<AssociationLink[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return tx
      .select({ id: associations.id, name: associations.name, slug: associations.slug })
      .from(associations)
      .where(inArray(associations.id, sql`(select my_association_ids())`))
      .orderBy(asc(associations.name));
  });
}

// すべての協会（運営管理者の切り替えメニュー用・§5.14「テナントの切り替え」）。名前の順
export async function listAllAssociations(db: Reader): Promise<AssociationLink[]> {
  return db
    .select({ id: associations.id, name: associations.name, slug: associations.slug })
    .from(associations)
    .orderBy(asc(associations.name));
}
