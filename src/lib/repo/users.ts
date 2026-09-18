import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";

// アカウント（users）。テナントに属さない表なので withTenant の外から読み書きする（§7.0）

export type UserProfile = { displayName: string | null; email: string };

export async function findUserProfile(db: Db, userId: string): Promise<UserProfile | null> {
  const [row] = await db
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

// 表示名の変更（§5.3）。値は src/lib/account/display-name.ts で整えたもの（null = 表示名なし）
export async function updateDisplayName(db: Db, userId: string, displayName: string | null): Promise<void> {
  await db
    .update(users)
    .set({ displayName, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
}
