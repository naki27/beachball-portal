import { sql } from "drizzle-orm";
import { getDb } from "./client";

// withTenant のコールバックが受け取るトランザクション
export type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export type TenantOptions = {
  // 操作している人。SECURITY DEFINER 関数（付録 A）が app.user_id で見る。未ログインなら渡さない
  userId?: string;
};

// DB を読む処理はすべてこの中で行う（設計書 §5.14「漏れを機構で防ぐ」2・4）
// トランザクションの冒頭で app.association_id（と app.user_id）を SET LOCAL し、RLS のポリシーがそれを見る
// set_config(name, value, true) は SET LOCAL と同じで、値をパラメータとして渡せる（文字列を連結しない）
// セッション単位の SET は使わない（プール経由で別のリクエストに漏れる）
export async function withTenant<T>(
  associationId: string,
  fn: (tx: Tx) => Promise<T>,
  options: TenantOptions = {},
): Promise<T> {
  if (!associationId) throw new Error("withTenant: associationId は必須です");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.association_id', ${associationId}, true)`);
    if (options.userId) {
      await tx.execute(sql`select set_config('app.user_id', ${options.userId}, true)`);
    }
    return fn(tx);
  });
}
