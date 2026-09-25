import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  type MembershipSource,
  type MembershipStatus,
  membershipDeclarations,
  membershipPeriods,
  memberships,
  type TeamKind,
  teams,
} from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 年度別の協会員資格（設計書 §5.12）。判定そのものは src/lib/membership.ts（ここは行を読むだけ）
// 年度 = 開始年（src/lib/date.ts の fiscalYear）。削除済みは除く

export type MembershipPeriod = {
  id: string;
  year: number;
  opensAt: Date;
  closesAt: Date;
  autoApprove: boolean;
};

// その年度の受付（membership_periods）。なければ null
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

// その年度に取り込み（source = import）の行があるか（付録 F の no_data の判定）
export async function hasImportedMemberships(tx: Tx, associationId: string, year: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.associationId, associationId), eq(memberships.year, year), eq(memberships.source, "import"), isNull(memberships.deletedAt)))
    .limit(1);
  return !!row;
}

export type MembershipRow = { id: string; status: MembershipStatus; source: MembershipSource; teamId: string | null };

// 人物 × 年度の行をまとめて読む（memberId → year → 行）。判定は membership.ts が行う
export async function listMembershipRows(
  tx: Tx,
  associationId: string,
  memberIds: readonly string[],
  years: readonly number[],
): Promise<Map<string, Map<number, MembershipRow>>> {
  const result = new Map<string, Map<number, MembershipRow>>();
  if (memberIds.length === 0 || years.length === 0) return result;
  const rows = await tx
    .select({ id: memberships.id, memberId: memberships.memberId, year: memberships.year, status: memberships.status, source: memberships.source, teamId: memberships.teamId })
    .from(memberships)
    .where(
      and(
        eq(memberships.associationId, associationId),
        isNull(memberships.deletedAt),
        inArray(memberships.memberId, [...memberIds]),
        inArray(memberships.year, [...years]),
      ),
    );
  for (const row of rows) {
    const byYear = result.get(row.memberId) ?? new Map<number, MembershipRow>();
    byYear.set(row.year, { id: row.id, status: row.status, source: row.source, teamId: row.teamId });
    result.set(row.memberId, byYear);
  }
  return result;
}

const PERIOD_COLUMNS = {
  id: membershipPeriods.id,
  year: membershipPeriods.year,
  opensAt: membershipPeriods.opensAt,
  closesAt: membershipPeriods.closesAt,
  autoApprove: membershipPeriods.autoApprove,
};

// 受付の一覧（年度の新しい順）
export async function listMembershipPeriods(tx: Tx, associationId: string): Promise<MembershipPeriod[]> {
  return tx.select(PERIOD_COLUMNS).from(membershipPeriods).where(eq(membershipPeriods.associationId, associationId)).orderBy(desc(membershipPeriods.year));
}

export async function findMembershipPeriodById(tx: Tx, associationId: string, id: string): Promise<MembershipPeriod | null> {
  const [row] = await tx
    .select(PERIOD_COLUMNS)
    .from(membershipPeriods)
    .where(and(eq(membershipPeriods.associationId, associationId), eq(membershipPeriods.id, id)))
    .limit(1);
  return row ?? null;
}

// いま受付中（開始 ≦ now ≦ 締切）の受付。重なっていれば年度の新しいほう
export async function findOpenMembershipPeriod(tx: Tx, associationId: string, now: Date): Promise<MembershipPeriod | null> {
  const [row] = await tx
    .select(PERIOD_COLUMNS)
    .from(membershipPeriods)
    .where(and(eq(membershipPeriods.associationId, associationId), lte(membershipPeriods.opensAt, now), gte(membershipPeriods.closesAt, now)))
    .orderBy(desc(membershipPeriods.year))
    .limit(1);
  return row ?? null;
}

export type NewMembershipPeriod = { year: number; opensAt: Date; closesAt: Date; autoApprove: boolean };

export async function insertMembershipPeriod(tx: Tx, associationId: string, values: NewMembershipPeriod): Promise<MembershipPeriod> {
  const [row] = await tx
    .insert(membershipPeriods)
    .values({ associationId, ...values })
    .returning(PERIOD_COLUMNS);
  return row;
}

export async function updateMembershipPeriod(
  tx: Tx,
  associationId: string,
  id: string,
  patch: Partial<Pick<NewMembershipPeriod, "opensAt" | "closesAt" | "autoApprove">>,
): Promise<MembershipPeriod | null> {
  const [row] = await tx
    .update(membershipPeriods)
    .set(patch)
    .where(and(eq(membershipPeriods.associationId, associationId), eq(membershipPeriods.id, id)))
    .returning(PERIOD_COLUMNS);
  return row ?? null;
}

// その年度の申告を送ったチーム（membership_declarations に行があるチーム）
export async function listDeclaredTeamIds(tx: Tx, associationId: string, year: number): Promise<Set<string>> {
  const rows = await tx
    .select({ teamId: membershipDeclarations.teamId })
    .from(membershipDeclarations)
    .where(and(eq(membershipDeclarations.associationId, associationId), eq(membershipDeclarations.year, year)));
  return new Set(rows.map((r) => r.teamId));
}

export type RenewalTargetTeam = { id: string; name: string; kind: TeamKind };

// 年度更新の対象チーム（§5.12）: 「協会員の登録をするチーム」と個人登録。有効で削除されていないものだけ
export async function listRenewalTargetTeams(tx: Tx, associationId: string): Promise<RenewalTargetTeam[]> {
  return tx
    .select({ id: teams.id, name: teams.name, kind: teams.kind })
    .from(teams)
    .where(
      and(
        eq(teams.associationId, associationId),
        isNull(teams.deletedAt),
        eq(teams.status, "active"),
        or(eq(teams.membershipRenewalTarget, true), eq(teams.kind, "individual")),
      ),
    )
    .orderBy(teams.name);
}

export function isRenewalTarget(team: { kind: TeamKind; membershipRenewalTarget: boolean; status: string; deletedAt: Date | null }): boolean {
  return team.deletedAt === null && team.status === "active" && (team.kind === "individual" || team.membershipRenewalTarget);
}

// チームの申告の送信記録（membership_declarations・§5.12）。行がない = 未申告
export type Declaration = { id: string; submittedBy: string | null; submittedAt: Date; updatedAt: Date };

export async function findDeclaration(tx: Tx, associationId: string, teamId: string, year: number): Promise<Declaration | null> {
  const [row] = await tx
    .select({
      id: membershipDeclarations.id,
      submittedBy: membershipDeclarations.submittedBy,
      submittedAt: membershipDeclarations.submittedAt,
      updatedAt: membershipDeclarations.updatedAt,
    })
    .from(membershipDeclarations)
    .where(and(eq(membershipDeclarations.associationId, associationId), eq(membershipDeclarations.teamId, teamId), eq(membershipDeclarations.year, year)))
    .limit(1);
  return row ?? null;
}

// 送信のたびに呼ぶ。初回は行を作り、2 回目からは最終更新だけ進める
export async function upsertDeclaration(tx: Tx, associationId: string, teamId: string, year: number, submittedBy: string, now: Date): Promise<void> {
  const current = await findDeclaration(tx, associationId, teamId, year);
  if (current) {
    await tx.update(membershipDeclarations).set({ submittedBy, updatedAt: now }).where(eq(membershipDeclarations.id, current.id));
    return;
  }
  await tx.insert(membershipDeclarations).values({ associationId, teamId, year, submittedBy, submittedAt: now, updatedAt: now });
}

export type NewMembership = {
  memberId: string;
  teamId: string | null;
  year: number;
  status: MembershipStatus;
  source: MembershipSource;
  appliedBy: string | null;
  appliedAt: Date | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
};

export async function insertMembership(tx: Tx, associationId: string, values: NewMembership): Promise<{ id: string }> {
  const [row] = await tx
    .insert(memberships)
    .values({ associationId, ...values })
    .returning({ id: memberships.id });
  return row;
}

export type MembershipPatch = Partial<Pick<NewMembership, "status" | "source" | "teamId" | "appliedBy" | "appliedAt" | "approvedBy" | "approvedAt">>;

export async function updateMembership(tx: Tx, associationId: string, id: string, patch: MembershipPatch): Promise<void> {
  await tx
    .update(memberships)
    .set(patch)
    .where(and(eq(memberships.associationId, associationId), eq(memberships.id, id), isNull(memberships.deletedAt)));
}

// そのチームから申告した、その年度の会員（申告済み・承認済み）の数（控えのメール用）
export async function countTeamMemberships(tx: Tx, associationId: string, teamId: string, year: number, statuses: readonly MembershipStatus[]): Promise<number> {
  const rows = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.associationId, associationId),
        eq(memberships.teamId, teamId),
        eq(memberships.year, year),
        inArray(memberships.status, [...statuses]),
        isNull(memberships.deletedAt),
      ),
    );
  return rows.length;
}

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
