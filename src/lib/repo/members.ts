import { and, eq } from "drizzle-orm";
import { type MemberSex, members } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { type ReadOptions, tenantScope } from "./scope";

export type Member = typeof members.$inferSelect;

export type NewMember = {
  name: string;
  kana?: string | null;
  birthDate: string; // YYYY-MM-DD（§7.0）
  sex: MemberSex;
  nameNormalized: string; // src/lib/normalize.ts（A-04）で作る
  kanaNormalized?: string | null;
  userId?: string | null;
};

// 人物のリポジトリ。すべて withTenant の tx の中で、associationId を必ず渡して呼ぶ
// 生年月日を返すのは、代表者が務めるチームの選手と本人だけ（CLAUDE.md）。呼ぶ側で絞る
export async function findMember(
  tx: Tx,
  associationId: string,
  memberId: string,
  options?: ReadOptions,
): Promise<Member | null> {
  const [row] = await tx
    .select()
    .from(members)
    .where(and(tenantScope(members, associationId, options), eq(members.id, memberId)))
    .limit(1);
  return row ?? null;
}

export async function createMember(tx: Tx, associationId: string, input: NewMember): Promise<Member> {
  const [row] = await tx
    .insert(members)
    .values({ associationId, ...input })
    .returning();
  return row;
}

// 論理削除（§5.16）。削除済みか、ほかの協会の行なら false
export async function softDeleteMember(
  tx: Tx,
  associationId: string,
  memberId: string,
  deletedBy: string,
): Promise<boolean> {
  const rows = await tx
    .update(members)
    .set({ deletedAt: new Date(), deletedBy })
    .where(and(tenantScope(members, associationId), eq(members.id, memberId)))
    .returning({ id: members.id });
  return rows.length > 0;
}
