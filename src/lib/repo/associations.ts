import { eq, sql } from "drizzle-orm";
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
