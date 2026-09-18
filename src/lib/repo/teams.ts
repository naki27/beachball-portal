import { and, asc, eq, isNull } from "drizzle-orm";
import { members, type TeamKind, type TeamStatus, teamAdmins, teamMembers, teams, users } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { type ReadOptions, tenantScope } from "./scope";

export type Team = typeof teams.$inferSelect;

export type NewTeam = {
  name: string;
  kana?: string | null;
  kind?: TeamKind;
  contactEmail?: string | null;
  contactPhone?: string | null;
  membershipRenewalTarget?: boolean;
  createdBy?: string | null;
};

// チームのリポジトリ。すべて withTenant の tx の中で、associationId を必ず渡して呼ぶ
export function listTeams(tx: Tx, associationId: string, options?: ReadOptions): Promise<Team[]> {
  return tx.select().from(teams).where(tenantScope(teams, associationId, options)).orderBy(teams.createdAt);
}

export async function findTeam(
  tx: Tx,
  associationId: string,
  teamId: string,
  options?: ReadOptions,
): Promise<Team | null> {
  const [row] = await tx
    .select()
    .from(teams)
    .where(and(tenantScope(teams, associationId, options), eq(teams.id, teamId)))
    .limit(1);
  return row ?? null;
}

export async function createTeam(tx: Tx, associationId: string, input: NewTeam): Promise<Team> {
  const [row] = await tx
    .insert(teams)
    .values({ associationId, ...input })
    .returning();
  return row;
}

// 論理削除（§5.16）。削除済みか、ほかの協会の行なら false
export async function softDeleteTeam(tx: Tx, associationId: string, teamId: string, deletedBy: string): Promise<boolean> {
  const rows = await tx
    .update(teams)
    .set({ deletedAt: new Date(), deletedBy })
    .where(and(tenantScope(teams, associationId), eq(teams.id, teamId)))
    .returning({ id: teams.id });
  return rows.length > 0;
}

export type TeamPatch = Partial<Pick<Team, "name" | "kana" | "contactEmail" | "contactPhone" | "membershipRenewalTarget">>;

// チーム情報の更新。削除済みか、ほかの協会の行なら null
export async function updateTeam(tx: Tx, associationId: string, teamId: string, patch: TeamPatch): Promise<Team | null> {
  const [row] = await tx
    .update(teams)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(tenantScope(teams, associationId), eq(teams.id, teamId)))
    .returning();
  return row ?? null;
}

// 協会のチームの ID と名前（同名のチームの警告用・§5.11）。削除済みは除く
export function listTeamNames(tx: Tx, associationId: string): Promise<{ id: string; name: string }[]> {
  return tx.select({ id: teams.id, name: teams.name }).from(teams).where(tenantScope(teams, associationId));
}

// 代表者を加える（§5.11）。grantedBy が NULL = チームを登録した本人
export async function addTeamAdmin(
  tx: Tx,
  associationId: string,
  teamId: string,
  userId: string,
  grantedBy: string | null,
): Promise<void> {
  await tx.insert(teamAdmins).values({ associationId, teamId, userId, grantedBy });
}

// その人が代表者を務めるチーム（解除されていない・チームが削除されていない）。名前の順
export async function listTeamsAdminedBy(tx: Tx, associationId: string, userId: string): Promise<Team[]> {
  const rows = await tx
    .select({ team: teams })
    .from(teamAdmins)
    .innerJoin(teams, and(eq(teams.associationId, teamAdmins.associationId), eq(teams.id, teamAdmins.teamId)))
    .where(
      and(
        eq(teamAdmins.associationId, associationId),
        eq(teamAdmins.userId, userId),
        isNull(teamAdmins.revokedAt),
        tenantScope(teams, associationId),
      ),
    )
    .orderBy(asc(teams.name));
  return rows.map((r) => r.team);
}

// その人の個人登録（kind = individual・削除されていない）。1 協会 1 つ（teams_individual_uk・§5.11）
export async function findIndividualTeamOf(tx: Tx, associationId: string, userId: string): Promise<Team | null> {
  const [row] = await tx
    .select()
    .from(teams)
    .where(and(tenantScope(teams, associationId), eq(teams.kind, "individual"), eq(teams.createdBy, userId)))
    .limit(1);
  return row ?? null;
}

// その人がそのチームの代表者（解除されていない）か
export async function isActiveTeamAdmin(tx: Tx, associationId: string, teamId: string, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: teamAdmins.id })
    .from(teamAdmins)
    .where(and(eq(teamAdmins.associationId, associationId), eq(teamAdmins.teamId, teamId), eq(teamAdmins.userId, userId), isNull(teamAdmins.revokedAt)))
    .limit(1);
  return !!row;
}

// その人が選手として所属するチーム（本人の人物が現役の選手一覧にいる・§3.2）。個人登録は含めない。名前の順
export async function listTeamsWherePlayer(tx: Tx, associationId: string, userId: string): Promise<Team[]> {
  const rows = await tx
    .select({ team: teams })
    .from(members)
    .innerJoin(teamMembers, and(eq(teamMembers.associationId, members.associationId), eq(teamMembers.memberId, members.id)))
    .innerJoin(teams, and(eq(teams.associationId, teamMembers.associationId), eq(teams.id, teamMembers.teamId)))
    .where(
      and(
        eq(members.associationId, associationId),
        eq(members.userId, userId),
        isNull(members.deletedAt),
        isNull(teamMembers.leftAt),
        isNull(teamMembers.deletedAt),
        tenantScope(teams, associationId),
        eq(teams.kind, "team"),
      ),
    )
    .orderBy(asc(teams.name));
  return rows.map((r) => r.team);
}

export type TeamAdminRow = { userId: string; email: string; displayName: string | null; grantedBy: string | null; grantedAt: Date };

// チームの代表者（解除されていない）。表示名・メールアドレスは代表者どうしで見える（誰が代表者かを知るため）
export async function listTeamAdmins(tx: Tx, associationId: string, teamId: string): Promise<TeamAdminRow[]> {
  return tx
    .select({ userId: teamAdmins.userId, email: users.email, displayName: users.displayName, grantedBy: teamAdmins.grantedBy, grantedAt: teamAdmins.grantedAt })
    .from(teamAdmins)
    .innerJoin(users, and(eq(users.id, teamAdmins.userId), isNull(users.deletedAt)))
    .where(and(eq(teamAdmins.associationId, associationId), eq(teamAdmins.teamId, teamId), isNull(teamAdmins.revokedAt)))
    .orderBy(asc(teamAdmins.grantedAt));
}

// 無効化・有効に戻す（§5.11）
export async function setTeamStatusRow(tx: Tx, associationId: string, teamId: string, status: TeamStatus): Promise<void> {
  await tx
    .update(teams)
    .set({ status, updatedAt: new Date() })
    .where(and(tenantScope(teams, associationId), eq(teams.id, teamId)));
}
