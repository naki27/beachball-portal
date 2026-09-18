import { sql } from "drizzle-orm";
import { type Db, getDb } from "./client";

// withTenant のコールバックが受け取るトランザクション
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type TenantOptions = {
  // 操作している人。SECURITY DEFINER 関数（付録 A）が app.user_id で見る。未ログインなら渡さない
  userId?: string;
};

function assertAssociationId(associationId: string): void {
  if (!associationId) throw new Error("withTenant: associationId は必須です");
}

// トランザクションの中で協会（と操作している人）を SET LOCAL する。RLS のポリシーは current_association_id() でこれを見る
// set_config(name, value, true) は SET LOCAL と同じで、値をパラメータとして渡せる（文字列を連結しない）
// FORCE ROW LEVEL SECURITY なので、所有者（app_owner）で動く seed やテストもこれを通す
export async function setTenant(tx: Tx, associationId: string, options: TenantOptions = {}): Promise<void> {
  assertAssociationId(associationId);
  await tx.execute(sql`select set_config('app.association_id', ${associationId}, true)`);
  if (options.userId) {
    await tx.execute(sql`select set_config('app.user_id', ${options.userId}, true)`);
  }
}

// 指定した接続で、1 つのトランザクションを協会に固定して fn を実行する（seed・テスト・ジョブ用）
export async function withTenantOn<T>(
  db: Db,
  associationId: string,
  fn: (tx: Tx) => Promise<T>,
  options: TenantOptions = {},
): Promise<T> {
  assertAssociationId(associationId);
  return db.transaction(async (tx) => {
    await setTenant(tx, associationId, options);
    return fn(tx);
  });
}

// DB を読む処理はすべてこの中で行う（設計書 §5.14「漏れを機構で防ぐ」2・4）。アプリ用の接続（app_user）を使う
// BEGIN → SET LOCAL app.association_id（・app.user_id）→ クエリ → COMMIT。セッション単位の SET は使わない（プールで別のリクエストに漏れる）
export function withTenant<T>(
  associationId: string,
  fn: (tx: Tx) => Promise<T>,
  options: TenantOptions = {},
): Promise<T> {
  return withTenantOn(getDb(), associationId, fn, options);
}
