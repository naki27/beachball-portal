import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { membershipDeclarations, membershipPeriods, memberships } from "@/db/schema";
import type { MembershipSource, MembershipStatus } from "@/db/schema/memberships";
import type { Tx } from "@/db/tenant";

// 年度別の協会員資格（設計書 §5.12）。判定そのものは src/lib/membership.ts だけで行う（ここはデータアクセス）
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

// その人物のその年度の資格（1 行だけ。削除済みは除く・部分一意インデックス memberships_member_year_uk）
export async function findMembership(
  tx: Tx,
  associationId: string,
  memberId: string,
  year: number,
): Promise<{ status: MembershipStatus; source: MembershipSource } | null> {
  const [row] = await tx
    .select({ status: memberships.status, source: memberships.source })
    .from(memberships)
    .where(
      and(
        eq(memberships.associationId, associationId),
        eq(memberships.memberId, memberId),
        eq(memberships.year, year),
        isNull(memberships.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// 渡した人物のその年度の状態（一覧・CSV 用。1 人ずつ問い合わせない）
export async function listMembershipStatuses(
  tx: Tx,
  associationId: string,
  year: number,
  memberIds: readonly string[],
): Promise<Map<string, MembershipStatus>> {
  if (memberIds.length === 0) return new Map();
  const rows = await tx
    .select({ memberId: memberships.memberId, status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.associationId, associationId),
        eq(memberships.year, year),
        isNull(memberships.deletedAt),
        inArray(memberships.memberId, [...memberIds]),
      ),
    );
  return new Map(rows.map((row) => [row.memberId, row.status]));
}

// その年度に取り込み（source = import）のデータがあるか。受付がなくてもデータがあれば区分を出す（§5.12「表示」）
export async function hasImportedMemberships(tx: Tx, associationId: string, year: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.associationId, associationId),
        eq(memberships.year, year),
        eq(memberships.source, "import"),
        isNull(memberships.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

// 年度更新の受付（membership_periods）。年度ごとに 1 行
export type MembershipPeriod = { id: string; year: number; opensAt: Date; closesAt: Date; autoApprove: boolean };

export async function findMembershipPeriod(tx: Tx, associationId: string, year: number): Promise<MembershipPeriod | null> {
  const [row] = await tx
    .select({
      id: membershipPeriods.id,
      year: membershipPeriods.year,
      opensAt: membershipPeriods.opensAt,
      closesAt: membershipPeriods.closesAt,
      autoApprove: membershipPeriods.autoApprove,
    })
    .from(membershipPeriods)
    .where(and(eq(membershipPeriods.associationId, associationId), eq(membershipPeriods.year, year)))
    .limit(1);
  return row ?? null;
}

export async function listMembershipPeriods(tx: Tx, associationId: string): Promise<MembershipPeriod[]> {
  return tx
    .select({
      id: membershipPeriods.id,
      year: membershipPeriods.year,
      opensAt: membershipPeriods.opensAt,
      closesAt: membershipPeriods.closesAt,
      autoApprove: membershipPeriods.autoApprove,
    })
    .from(membershipPeriods)
    .where(eq(membershipPeriods.associationId, associationId))
    .orderBy(desc(membershipPeriods.year));
}

export type MembershipPeriodValues = { year: number; opensAt: Date; closesAt: Date; autoApprove: boolean };

export async function insertMembershipPeriod(tx: Tx, associationId: string, values: MembershipPeriodValues): Promise<void> {
  await tx.insert(membershipPeriods).values({ associationId, ...values });
}

export async function updateMembershipPeriod(
  tx: Tx,
  associationId: string,
  year: number,
  values: Omit<MembershipPeriodValues, "year">,
): Promise<boolean> {
  const updated = await tx
    .update(membershipPeriods)
    .set(values)
    .where(and(eq(membershipPeriods.associationId, associationId), eq(membershipPeriods.year, year)))
    .returning({ id: membershipPeriods.id });
  return updated.length > 0;
}

// 申告を送信したチーム（membership_declarations に行があるチーム）。未申告の一覧はこの裏を取る
export async function listDeclaredTeamIds(tx: Tx, associationId: string, year: number): Promise<Set<string>> {
  const rows = await tx
    .select({ teamId: membershipDeclarations.teamId })
    .from(membershipDeclarations)
    .where(and(eq(membershipDeclarations.associationId, associationId), eq(membershipDeclarations.year, year)));
  return new Set(rows.map((row) => row.teamId));
}
