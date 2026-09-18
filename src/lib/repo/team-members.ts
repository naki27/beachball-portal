import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { type MemberSex, type MemberStatus, members, teamMembers, teams } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 選手一覧（team_members = 人物の所属・§5.15）のリポジトリ。すべて withTenant の tx の中で、associationId を必ず渡して呼ぶ
// 削除済み（deleted_at: 誤登録の取り消し。テナント管理者だけ）は既定で除く。外した行（left_at）は関数ごとに扱いが違う
// 行には生年月日が含まれる。画面・API に返す前に src/lib/teams/roster.ts で権限に合わせて絞る

export type RosterRow = {
  teamMemberId: string;
  memberId: string;
  joinedAt: Date;
  leftAt: Date | null;
  leftBy: string | null;
  name: string;
  kana: string | null;
  birthDate: string;
  sex: MemberSex;
  status: MemberStatus;
  userId: string | null;
};

const rosterColumns = {
  teamMemberId: teamMembers.id,
  memberId: members.id,
  joinedAt: teamMembers.joinedAt,
  leftAt: teamMembers.leftAt,
  leftBy: teamMembers.leftBy,
  name: members.name,
  kana: members.kana,
  birthDate: members.birthDate,
  sex: members.sex,
  status: members.status,
  userId: members.userId,
};

function joinMembers(tx: Tx) {
  return tx
    .select(rosterColumns)
    .from(teamMembers)
    .innerJoin(members, and(eq(members.associationId, teamMembers.associationId), eq(members.id, teamMembers.memberId)));
}

// 現役の選手（left_at・deleted_at が NULL。人物が削除されていない）。加わった順
export function listActiveRoster(tx: Tx, associationId: string, teamId: string): Promise<RosterRow[]> {
  return joinMembers(tx)
    .where(
      and(
        eq(teamMembers.associationId, associationId),
        eq(teamMembers.teamId, teamId),
        isNull(teamMembers.deletedAt),
        isNull(teamMembers.leftAt),
        isNull(members.deletedAt),
      ),
    )
    .orderBy(asc(teamMembers.joinedAt));
}

// その人が since より後に外した行（「外しました［元に戻す］」用・§5.11）
export function listRecentlyLeftBy(tx: Tx, associationId: string, teamId: string, leftBy: string, since: Date): Promise<RosterRow[]> {
  return joinMembers(tx)
    .where(
      and(
        eq(teamMembers.associationId, associationId),
        eq(teamMembers.teamId, teamId),
        isNull(teamMembers.deletedAt),
        eq(teamMembers.leftBy, leftBy),
        isNotNull(teamMembers.leftAt),
        gt(teamMembers.leftAt, since),
        isNull(members.deletedAt),
      ),
    )
    .orderBy(asc(teamMembers.leftAt));
}

// 選手一覧の 1 行（外した行も含む。削除済みは除く）
export async function findTeamMemberRow(tx: Tx, associationId: string, teamId: string, teamMemberId: string): Promise<RosterRow | null> {
  const [row] = await joinMembers(tx)
    .where(
      and(
        eq(teamMembers.associationId, associationId),
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.id, teamMemberId),
        isNull(teamMembers.deletedAt),
        isNull(members.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// その人物がそのチームの現役の選手一覧にいるか
export async function findActiveTeamMember(tx: Tx, associationId: string, teamId: string, memberId: string): Promise<{ id: string } | null> {
  const [row] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.associationId, associationId),
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.memberId, memberId),
        isNull(teamMembers.leftAt),
        isNull(teamMembers.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function addTeamMember(tx: Tx, associationId: string, teamId: string, memberId: string): Promise<{ id: string }> {
  const [row] = await tx.insert(teamMembers).values({ associationId, teamId, memberId }).returning({ id: teamMembers.id });
  return row;
}

// 選手一覧から外す（脱退。物理削除しない・§5.11）
export async function markTeamMemberLeft(tx: Tx, associationId: string, teamMemberId: string, leftBy: string, at: Date): Promise<void> {
  await tx
    .update(teamMembers)
    .set({ leftAt: at, leftBy })
    .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.id, teamMemberId)));
}

// 外したのを元に戻す
export async function clearTeamMemberLeft(tx: Tx, associationId: string, teamMemberId: string): Promise<void> {
  await tx
    .update(teamMembers)
    .set({ leftAt: null, leftBy: null })
    .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.id, teamMemberId)));
}

// その人物が現役の選手として載っているチームの名前（削除されていないチーム）
export async function listTeamNamesOfMember(tx: Tx, associationId: string, memberId: string): Promise<string[]> {
  const rows = await tx
    .select({ name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, and(eq(teams.associationId, teamMembers.associationId), eq(teams.id, teamMembers.teamId)))
    .where(
      and(
        eq(teamMembers.associationId, associationId),
        eq(teamMembers.memberId, memberId),
        isNull(teamMembers.leftAt),
        isNull(teamMembers.deletedAt),
        isNull(teams.deletedAt),
        eq(teams.kind, "team"),
      ),
    )
    .orderBy(asc(teams.name));
  return rows.map((r) => r.name);
}

// 現役の選手のうち、本人のアカウントに紐づいている人（代表者の候補・§5.11「代表者の委譲」）
export async function listLinkedRoster(tx: Tx, associationId: string, teamId: string): Promise<{ memberId: string; name: string; userId: string }[]> {
  const rows = await listActiveRoster(tx, associationId, teamId);
  return rows.filter((r): r is RosterRow & { userId: string } => r.userId !== null).map((r) => ({ memberId: r.memberId, name: r.name, userId: r.userId }));
}
