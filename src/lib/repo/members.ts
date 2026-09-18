import { and, eq, inArray, ne, or } from "drizzle-orm";
import { type MemberSex, type MemberStatus, members } from "@/db/schema";
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
  status?: MemberStatus; // 名寄せで判断を保留したら needs_review（§8.3）
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

// 人物の情報の修正（§5.11「名簿の管理」）。正規化列も一緒に更新する。削除済みか、ほかの協会の行なら false
export async function updateMemberPerson(
  tx: Tx,
  associationId: string,
  memberId: string,
  input: Pick<NewMember, "name" | "kana" | "birthDate" | "sex" | "nameNormalized" | "kanaNormalized">,
): Promise<boolean> {
  const rows = await tx
    .update(members)
    .set({ ...input, updatedAt: new Date() })
    .where(and(tenantScope(members, associationId), eq(members.id, memberId)))
    .returning({ id: members.id });
  return rows.length > 0;
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

// 名寄せの候補（§8.3「探索対象」）。同じ協会の、active / needs_review で削除されていない人物のうち、
// 氏名（正規化後）が一致する人と、ふりがな（正規化後）と生年月日が一致する人。ふりがなが空なら後者は探さない
// 判定は src/lib/matching.ts。ここは候補を引くだけ（生年月日を含むので、呼ぶ側は画面に返さない）
export type MatchCandidateRow = Pick<Member, "id" | "nameNormalized" | "kanaNormalized" | "birthDate" | "sex" | "status">;

export function listMatchCandidates(
  tx: Tx,
  associationId: string,
  keys: { nameNormalized: string; kanaNormalized: string | null; birthDate: string },
): Promise<MatchCandidateRow[]> {
  const byName = eq(members.nameNormalized, keys.nameNormalized);
  const byKana = keys.kanaNormalized
    ? and(eq(members.kanaNormalized, keys.kanaNormalized), eq(members.birthDate, keys.birthDate))
    : undefined;
  return tx
    .select({
      id: members.id,
      nameNormalized: members.nameNormalized,
      kanaNormalized: members.kanaNormalized,
      birthDate: members.birthDate,
      sex: members.sex,
      status: members.status,
    })
    .from(members)
    .where(
      and(
        tenantScope(members, associationId),
        inArray(members.status, ["active", "needs_review"]),
        byKana ? or(byName, byKana) : byName,
      ),
    )
    .orderBy(members.createdAt);
}

// そのアカウントに紐づいた人物（協会内で 1 アカウント = 1 人物・§5.15）。統合済み・削除済みは除く
export async function findMemberByUserId(tx: Tx, associationId: string, userId: string): Promise<Member | null> {
  const [row] = await tx
    .select()
    .from(members)
    .where(and(tenantScope(members, associationId), eq(members.userId, userId), ne(members.status, "merged")))
    .limit(1);
  return row ?? null;
}

// 人物にアカウントを紐づける（招待の承諾・本人の登録・§5.15）。null で解除
export async function setMemberUser(tx: Tx, associationId: string, memberId: string, userId: string | null): Promise<void> {
  await tx
    .update(members)
    .set({ userId, updatedAt: new Date() })
    .where(and(tenantScope(members, associationId), eq(members.id, memberId)));
}

// 人物の状態を変える（要確認にする・解消する。統合は B-15）
export async function updateMemberStatus(tx: Tx, associationId: string, memberId: string, status: MemberStatus): Promise<void> {
  await tx
    .update(members)
    .set({ status, updatedAt: new Date() })
    .where(and(tenantScope(members, associationId), eq(members.id, memberId)));
}
