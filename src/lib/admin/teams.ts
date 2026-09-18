import { and, count, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { teamAdmins, teamMembers, teams, users } from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import { normalizeEmail } from "@/lib/auth/login-input";
import type { Principal } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { countOpenEntries } from "@/lib/repo/entries";
import { cancelOpenTeamInvitations } from "@/lib/repo/team-invitations";
import { addTeamAdmin, findTeam, listTeamAdmins, softDeleteTeam, type Team, type TeamAdminRow } from "@/lib/repo/teams";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// チーム管理（運営）（設計書 §4.2 #16・§5.11「チームの無効化と削除」・§5.16）。テナント管理者だけ
// 一覧・検索、代表者の付け替え（追加・解除）、削除（論理）。編集・協会員の登録をするチームか・無効化は代表者と同じ API を使う

export type AdminTeamRow = Pick<Team, "id" | "name" | "kind" | "status" | "membershipRenewalTarget" | "createdAt"> & {
  admins: number;
  players: number;
};

// チームごとの代表者・現役の選手の数
async function countsByTeam(tx: Tx, associationId: string, teamIds: string[]): Promise<Map<string, { admins: number; players: number }>> {
  const result = new Map<string, { admins: number; players: number }>();
  if (teamIds.length === 0) return result;
  const admins = await tx
    .select({ teamId: teamAdmins.teamId, value: count() })
    .from(teamAdmins)
    .where(and(eq(teamAdmins.associationId, associationId), inArray(teamAdmins.teamId, teamIds), isNull(teamAdmins.revokedAt)))
    .groupBy(teamAdmins.teamId);
  const players = await tx
    .select({ teamId: teamMembers.teamId, value: count() })
    .from(teamMembers)
    .where(and(eq(teamMembers.associationId, associationId), inArray(teamMembers.teamId, teamIds), isNull(teamMembers.leftAt), isNull(teamMembers.deletedAt)))
    .groupBy(teamMembers.teamId);
  for (const id of teamIds) result.set(id, { admins: 0, players: 0 });
  for (const a of admins) result.get(a.teamId)!.admins = a.value;
  for (const p of players) result.get(p.teamId)!.players = p.value;
  return result;
}

// 一覧（検索は名前の部分一致・大文字小文字を区別しない）。削除済みは出さない。新しい順・最大 200 件
export async function listTeamsForAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  query: string,
): Promise<AdminTeamRow[]> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const q = query.trim().replace(/[%_\\]/g, "");
      const rows = await tx
        .select({
          id: teams.id,
          name: teams.name,
          kind: teams.kind,
          status: teams.status,
          membershipRenewalTarget: teams.membershipRenewalTarget,
          createdAt: teams.createdAt,
        })
        .from(teams)
        .where(and(eq(teams.associationId, associationId), isNull(teams.deletedAt), q ? ilike(teams.name, `%${q}%`) : undefined))
        .orderBy(desc(teams.createdAt))
        .limit(200);
      const counts = await countsByTeam(
        tx,
        associationId,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({ ...r, ...(counts.get(r.id) ?? { admins: 0, players: 0 }) }));
    },
    { userId: principal.userId },
  );
}

export type AdminTeamDetail = { team: Team; admins: TeamAdminRow[]; players: number };

export async function getTeamForAdmin(db: Db, principal: Principal & { userId: string }, associationId: string, teamId: string): Promise<AdminTeamDetail> {
  if (!isUuid(teamId)) throw new TeamError(404, "チームが見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const team = await findTeam(tx, associationId, teamId);
      if (!team) throw new TeamError(404, "チームが見つかりません");
      const admins = await listTeamAdmins(tx, associationId, teamId);
      const counts = await countsByTeam(tx, associationId, [teamId]);
      return { team, admins, players: counts.get(teamId)?.players ?? 0 };
    },
    { userId: principal.userId },
  );
}

// 代表者の付け替え（追加）: 承諾なしで、そのアドレスのアカウントを代表者にする（テナント管理者だけ。docs/adr/0015）
export async function assignTeamAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  emailRaw: unknown,
): Promise<{ userId: string }> {
  if (!isUuid(teamId)) throw new TeamError(404, "チームが見つかりません");
  const email = typeof emailRaw === "string" ? normalizeEmail(emailRaw) : null;
  if (!email) throw new TeamError(400, "メールアドレスの形で入力してください", { field: "email" });
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const team = await findTeam(tx, associationId, teamId);
      if (!team) throw new TeamError(404, "チームが見つかりません");
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
      if (!user) throw new TeamError(409, "そのメールアドレスのアカウントはありません。本人が一度ログインしてから、もう一度お試しください", { field: "email" });
      const admins = await listTeamAdmins(tx, associationId, teamId);
      if (admins.some((a) => a.userId === user.id)) throw new TeamError(409, "この方はすでに代表者です", { field: "email" });
      await addTeamAdmin(tx, associationId, teamId, user.id, principal.userId);
      return { userId: user.id };
    },
    { userId: principal.userId },
  );
}

// チームの削除（論理・§5.11「チームの無効化と削除」・§5.16）。締切前の申込が残っていれば 409。返事待ちの招待は取り消す。代表者の行は残す
export async function deleteTeam(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(teamId)) throw new TeamError(404, "チームが見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const team = await findTeam(tx, associationId, teamId);
      if (!team) throw new TeamError(404, "チームが見つかりません");
      if ((await countOpenEntries(tx, associationId, teamId, now)) > 0) {
        throw new TeamError(409, "締切前の申し込みが残っています。先に申し込みを取り消してください");
      }
      await cancelOpenTeamInvitations(tx, associationId, teamId, now);
      await softDeleteTeam(tx, associationId, teamId, principal.userId);
    },
    { userId: principal.userId },
  );
}
