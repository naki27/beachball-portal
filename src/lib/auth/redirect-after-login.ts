import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { associations } from "@/db/schema";
import { safeNext } from "./login-input";

// ログイン後の戻り先（設計書 §5.2）
// ① ログインボタンを押した元のページ（next。同じサイト内の相対パスだけ）→ ② 協会のページから来たならその協会のトップ
// （next が協会のページなら ① に含まれる）→ ③ 役割を持つ協会が 1 つだけならその協会のトップ → ④ /mypage
export async function redirectAfterLogin(db: Db, userId: string, next: string | null | undefined): Promise<string> {
  const safe = safeNext(next);
  if (safe) return safe;

  // 役割を持つ協会は SECURITY DEFINER 関数 my_association_ids() で数える（app.user_id を SET LOCAL してから）
  const ids = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const result = await tx.execute<{ id: string }>(sql`select my_association_ids() as id`);
    return result.rows.map((r) => r.id);
  });
  if (ids.length === 1) {
    const [row] = await db.select({ slug: associations.slug }).from(associations).where(eq(associations.id, ids[0])).limit(1);
    if (row) return `/${row.slug}`;
  }
  return "/mypage";
}
