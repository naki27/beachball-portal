import { and, eq, inArray, isNull } from "drizzle-orm";
import { memberships } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 年度別の協会員資格（設計書 §5.12）。機能（年度更新）は 1d。ここは申込の「協会員だけを表示」で読むだけ
// 年度 = 開始年（src/lib/date.ts の fiscalYear）。削除済みは除く

// その年度のデータがあるか。なければ画面にスイッチを出さない（§5.5「入力ページ」3）
export async function hasMembershipsForYear(tx: Tx, associationId: string, year: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.associationId, associationId), eq(memberships.year, year), isNull(memberships.deletedAt)))
    .limit(1);
  return !!row;
}

// その年度に承認済み（approved）の人物。渡した memberIds のうち協会員である人だけを返す
export async function listApprovedMemberIds(
  tx: Tx,
  associationId: string,
  year: number,
  memberIds: string[],
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const rows = await tx
    .select({ memberId: memberships.memberId })
    .from(memberships)
    .where(
      and(
        eq(memberships.associationId, associationId),
        eq(memberships.year, year),
        eq(memberships.status, "approved"),
        isNull(memberships.deletedAt),
        inArray(memberships.memberId, memberIds),
      ),
    );
  return new Set(rows.map((r) => r.memberId));
}
