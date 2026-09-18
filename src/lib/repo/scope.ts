import { eq, isNull, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

// リポジトリ関数の共通の条件（設計書 §5.14「漏れを機構で防ぐ」1・§5.16）
// - associationId は省略できない引数で受け取り、必ずクエリに入れる（RLS と二重にかける）
// - 削除済み（deleted_at）の除外は既定。読むのはテナント管理者の「削除済みデータ」画面だけ

export type ReadOptions = {
  // true にできるのは /admin/trash（削除済みデータ画面）だけ
  includeDeleted?: boolean;
};

type TenantTable = {
  associationId: PgColumn;
  deletedAt: PgColumn;
};

export function tenantScope(table: TenantTable, associationId: string, options: ReadOptions = {}): SQL {
  if (!associationId) throw new Error("associationId は必須です");
  const tenant = eq(table.associationId, associationId);
  return options.includeDeleted ? tenant : sql`${tenant} and ${isNull(table.deletedAt)}`;
}
