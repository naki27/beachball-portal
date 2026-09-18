import { and, asc, eq, isNull, like, ne, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type MemberSex, type MemberStatus, members, teamMembers, teams, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { ageAt } from "@/lib/age";
import type { Principal } from "@/lib/authz";
import { parsePlainDate, todayInTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { matchKeysOf } from "@/lib/matching";
import { normalizeName } from "@/lib/normalize";
import { findMember, type Member, updateMemberPerson } from "@/lib/repo/members";
import { TeamError } from "@/lib/teams/errors";
import { parsePlayerInput, type PlayerInput } from "@/lib/teams/player-input";
import { authorizeAssociationAdmin } from "./access";

// メンバー管理（運営）（設計書 §4.2 #15・§5.8・§5.16）。テナント管理者だけ（全員の生年月日を見られる・§3.2）
// 検索・編集・誤登録の選手一覧の行の削除（team_members.deleted_at）。アカウントとの紐づけの解除は src/lib/teams/self.ts の unlinkMember
// 要確認の解消と 2 つの人物をまとめる画面は B-15

export type AdminMemberRow = {
  id: string;
  name: string;
  kana: string | null;
  birthDate: string;
  age: number;
  sex: MemberSex;
  status: MemberStatus;
  linked: boolean;
};

function rowOf(m: Member, now: Date): AdminMemberRow {
  const birth = parsePlainDate(m.birthDate);
  return {
    id: m.id,
    name: m.name,
    kana: m.kana,
    birthDate: m.birthDate,
    age: birth ? ageAt(birth, todayInTokyo(now)) : 0,
    sex: m.sex,
    status: m.status,
    linked: m.userId !== null,
  };
}

// 検索（氏名・ふりがなの正規化後の部分一致）。空なら要確認の人物から順に、新しい順で最大 100 件。統合済み・削除済みは出さない
export async function searchMembersForAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  query: string,
  now: Date = new Date(),
): Promise<AdminMemberRow[]> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const key = normalizeName(query);
      const rows = await tx
        .select()
        .from(members)
        .where(
          and(
            eq(members.associationId, associationId),
            isNull(members.deletedAt),
            ne(members.status, "merged"),
            key ? or(like(members.nameNormalized, `%${key}%`), like(members.kanaNormalized, `%${key}%`)) : undefined,
          ),
        )
        .orderBy(asc(members.status), asc(members.nameNormalized))
        .limit(100);
      // needs_review を先に（"active" < "needs_review" の並びを直す）
      return rows.map((m) => rowOf(m, now)).sort((a, b) => Number(b.status === "needs_review") - Number(a.status === "needs_review"));
    },
    { userId: principal.userId },
  );
}

export type AdminMemberDetail = {
  member: AdminMemberRow;
  linkedEmail: string | null;
  // 現役で載っている選手一覧（外した行は含めない）
  teams: { teamMemberId: string; teamId: string; teamName: string; kind: "team" | "individual" }[];
};

export async function getMemberForAdmin(db: Db, principal: Principal & { userId: string }, associationId: string, memberId: string, now = new Date()): Promise<AdminMemberDetail> {
  if (!isUuid(memberId)) throw new TeamError(404, "登録が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const m = await findMember(tx, associationId, memberId);
      if (!m || m.status === "merged") throw new TeamError(404, "登録が見つかりません");
      const [u] = m.userId ? await tx.select({ email: users.email }).from(users).where(eq(users.id, m.userId)).limit(1) : [];
      const rows = await tx
        .select({ teamMemberId: teamMembers.id, teamId: teams.id, teamName: teams.name, kind: teams.kind })
        .from(teamMembers)
        .innerJoin(teams, and(eq(teams.associationId, teamMembers.associationId), eq(teams.id, teamMembers.teamId)))
        .where(
          and(
            eq(teamMembers.associationId, associationId),
            eq(teamMembers.memberId, memberId),
            isNull(teamMembers.leftAt),
            isNull(teamMembers.deletedAt),
            isNull(teams.deletedAt),
          ),
        )
        .orderBy(asc(teams.name));
      return { member: rowOf(m, now), linkedEmail: u?.email ?? null, teams: rows };
    },
    { userId: principal.userId },
  );
}

// 人物の情報の修正（テナント管理者）。正規化列も更新する
export async function updateMemberByAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  memberId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<PlayerInput> {
  if (!isUuid(memberId)) throw new TeamError(404, "登録が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const m = await findMember(tx, associationId, memberId);
      if (!m || m.status === "merged") throw new TeamError(404, "登録が見つかりません");
      const parsed = parsePlayerInput(raw, todayInTokyo(now));
      if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
      const keys = matchKeysOf(parsed.value);
      await updateMemberPerson(tx, associationId, memberId, { ...parsed.value, nameNormalized: keys.nameNormalized, kanaNormalized: keys.kanaNormalized });
      return parsed.value;
    },
    { userId: principal.userId },
  );
}

// 誤登録の選手一覧の行の削除（論理・§5.16「なかったことにする」）。テナント管理者だけ。人物は残る
export async function deleteTeamMemberRow(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  teamMemberId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(teamId) || !isUuid(teamMemberId)) throw new TeamError(404, "選手が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const rows = await tx
        .update(teamMembers)
        .set({ deletedAt: now, deletedBy: principal.userId })
        .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.teamId, teamId), eq(teamMembers.id, teamMemberId), isNull(teamMembers.deletedAt)))
        .returning({ id: teamMembers.id });
      if (rows.length === 0) throw new TeamError(404, "選手が見つかりません");
    },
    { userId: principal.userId },
  );
}
