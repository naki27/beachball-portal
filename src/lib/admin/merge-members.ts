import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { entries, entryPlayers, members, memberships, type MembershipStatus, teamInvitations, teamMembers, teams, users } from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import { ageAt } from "@/lib/age";
import type { Principal } from "@/lib/authz";
import { parsePlainDate, todayInTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { logAdminAccess } from "@/lib/repo/admin-access-logs";
import { findMember, updateMemberStatus } from "@/lib/repo/members";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 要確認の解消と、2 つの人物をまとめる（設計書 §5.8「要確認の解消と、2 つの人物をまとめる最小の画面」）。テナント管理者だけ
// **自動ではまとめない**。候補の自動提示・一括の統合・統合の取り消しは P2（元に戻す操作は作らない）

export type MergeCandidate = {
  id: string;
  name: string;
  kana: string | null;
  birthDate: string;
  age: number;
  sex: "male" | "female";
  status: "active" | "needs_review" | "merged";
  teamNames: string[];
  entryCount: number;
  linkedEmail: string | null;
  // 「どこが同じか」（横並びの見出しに出す）
  sameName: boolean;
  sameKanaAndBirth: boolean;
};

export type MergeView = {
  member: MergeCandidate;
  candidates: MergeCandidate[];
};

async function toCandidate(
  tx: Tx,
  associationId: string,
  row: typeof members.$inferSelect,
  now: Date,
  compareTo?: typeof members.$inferSelect,
): Promise<MergeCandidate> {
  const teamRows = await tx
    .select({ name: teams.name })
    .from(teamMembers)
    .innerJoin(teams, and(eq(teams.associationId, teamMembers.associationId), eq(teams.id, teamMembers.teamId)))
    .where(
      and(
        eq(teamMembers.associationId, associationId),
        eq(teamMembers.memberId, row.id),
        isNull(teamMembers.leftAt),
        isNull(teamMembers.deletedAt),
        isNull(teams.deletedAt),
      ),
    )
    .orderBy(asc(teams.name));
  const [linked] = row.userId ? await tx.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1) : [];
  const birth = parsePlainDate(row.birthDate);
  return {
    id: row.id,
    name: row.name,
    kana: row.kana,
    birthDate: row.birthDate,
    age: birth ? ageAt(birth, todayInTokyo(now)) : 0,
    sex: row.sex,
    status: row.status,
    teamNames: teamRows.map((t) => t.name),
    entryCount: row.entryCount,
    linkedEmail: linked?.email ?? null,
    sameName: !!compareTo && compareTo.nameNormalized === row.nameNormalized,
    sameKanaAndBirth:
      !!compareTo && !!compareTo.kanaNormalized && compareTo.kanaNormalized === row.kanaNormalized && compareTo.birthDate === row.birthDate,
  };
}

// 「確認が必要」の一覧（§5.8）
export async function listNeedsReview(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  now: Date = new Date(),
): Promise<MergeCandidate[]> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const rows = await tx
        .select()
        .from(members)
        .where(and(eq(members.associationId, associationId), eq(members.status, "needs_review"), isNull(members.deletedAt)))
        .orderBy(asc(members.nameNormalized))
        .limit(200);
      return Promise.all(rows.map((row) => toCandidate(tx, associationId, row, now)));
    },
    { userId: principal.userId },
  );
}

// 1 人を開いたときの横並びの比較（同じ氏名の人物、ふりがなと生年月日が同じ人物）
export async function getMergeView(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  memberId: string,
  now: Date = new Date(),
): Promise<MergeView> {
  if (!isUuid(memberId)) throw new TeamError(404, "登録が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const target = await findMember(tx, associationId, memberId);
      if (!target || target.status === "merged") throw new TeamError(404, "登録が見つかりません");

      const rows = await tx
        .select()
        .from(members)
        .where(
          and(
            eq(members.associationId, associationId),
            ne(members.id, target.id),
            ne(members.status, "merged"),
            isNull(members.deletedAt),
            or(
              eq(members.nameNormalized, target.nameNormalized),
              target.kanaNormalized
                ? and(eq(members.kanaNormalized, target.kanaNormalized), eq(members.birthDate, target.birthDate))
                : undefined,
            ),
          ),
        )
        .orderBy(asc(members.createdAt))
        .limit(20);

      return {
        member: await toCandidate(tx, associationId, target, now),
        candidates: await Promise.all(rows.map((row) => toCandidate(tx, associationId, row, now, target))),
      };
    },
    { userId: principal.userId },
  );
}

// 「別の人です」→ needs_review を外す（§5.8）
export async function resolveAsDifferentPerson(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  memberId: string,
): Promise<void> {
  if (!isUuid(memberId)) throw new TeamError(404, "登録が見つかりません");
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const member = await findMember(tx, associationId, memberId);
      if (!member || member.status === "merged") throw new TeamError(404, "登録が見つかりません");
      if (member.status !== "needs_review") throw new TeamError(409, "この登録は確認済みです");
      await updateMemberStatus(tx, associationId, memberId, "active");
    },
    { userId: principal.userId },
  );
}

// 同じ年度に両方あるときに残す 1 つ（approved → applied → declined → expired の順・§5.8）
const MEMBERSHIP_PRIORITY: Record<MembershipStatus, number> = { approved: 0, applied: 1, declined: 2, expired: 3 };

// 「同じ人です（まとめる）」（§5.8）。1 トランザクションで付け替える。元に戻す操作は作らない
export async function mergeMembers(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  keepId: string,
  removeId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(keepId) || !isUuid(removeId)) throw new TeamError(404, "登録が見つかりません");
  if (keepId === removeId) throw new TeamError(400, "同じ登録は選べません");

  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const keep = await findMember(tx, associationId, keepId);
      const remove = await findMember(tx, associationId, removeId);
      if (!keep || !remove || keep.status === "merged" || remove.status === "merged") {
        throw new TeamError(404, "登録が見つかりません");
      }
      // 両方が別のアカウントに紐づいていたらまとめられない（§5.8・§5.15）
      if (keep.userId && remove.userId && keep.userId !== remove.userId) {
        throw new TeamError(409, "どちらもログインできるアカウントと結びついています。先にどちらかの結びつきを解除してください");
      }

      // 選手一覧: 同じチームに両方いれば、消える側の行を論理削除して残す側だけにする
      const keepTeams = await tx
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.memberId, keepId), isNull(teamMembers.deletedAt)));
      const keepTeamIds = new Set(keepTeams.map((row) => row.teamId));
      const removeRows = await tx
        .select({ id: teamMembers.id, teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.memberId, removeId), isNull(teamMembers.deletedAt)));
      for (const row of removeRows) {
        if (keepTeamIds.has(row.teamId)) {
          await tx.update(teamMembers).set({ deletedAt: now, deletedBy: principal.userId }).where(eq(teamMembers.id, row.id));
        } else {
          await tx.update(teamMembers).set({ memberId: keepId }).where(eq(teamMembers.id, row.id));
          keepTeamIds.add(row.teamId);
        }
      }

      // 会員資格: 同じ年度に両方あれば、状態の優先順で 1 つだけ残す
      const keepMemberships = await tx
        .select({ id: memberships.id, year: memberships.year, status: memberships.status })
        .from(memberships)
        .where(and(eq(memberships.associationId, associationId), eq(memberships.memberId, keepId), isNull(memberships.deletedAt)));
      const byYear = new Map(keepMemberships.map((row) => [row.year, row]));
      const removeMemberships = await tx
        .select({ id: memberships.id, year: memberships.year, status: memberships.status })
        .from(memberships)
        .where(and(eq(memberships.associationId, associationId), eq(memberships.memberId, removeId), isNull(memberships.deletedAt)));
      for (const row of removeMemberships) {
        const kept = byYear.get(row.year);
        if (!kept) {
          await tx.update(memberships).set({ memberId: keepId }).where(eq(memberships.id, row.id));
          byYear.set(row.year, row);
          continue;
        }
        if (MEMBERSHIP_PRIORITY[row.status] < MEMBERSHIP_PRIORITY[kept.status]) {
          // 消える側のほうが強ければ、残す側の行を消してから付け替える
          await tx.update(memberships).set({ deletedAt: now, deletedBy: principal.userId }).where(eq(memberships.id, kept.id));
          await tx.update(memberships).set({ memberId: keepId }).where(eq(memberships.id, row.id));
          byYear.set(row.year, row);
        } else {
          await tx.update(memberships).set({ deletedAt: now, deletedBy: principal.userId }).where(eq(memberships.id, row.id));
        }
      }

      // 申込の選手（氏名などのスナップショットは変えない・§5.5）
      await tx
        .update(entryPlayers)
        .set({ memberId: keepId })
        .where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.memberId, removeId)));

      // 返事待ちの招待は取り消す
      await tx
        .update(teamInvitations)
        .set({ status: "cancelled", respondedAt: now })
        .where(
          and(
            eq(teamInvitations.associationId, associationId),
            eq(teamInvitations.memberId, removeId),
            eq(teamInvitations.status, "pending"),
          ),
        );

      // アカウントの紐づけは、片方だけにあれば残す側に移す
      if (!keep.userId && remove.userId) {
        await tx.update(members).set({ userId: null, updatedAt: now }).where(eq(members.id, removeId));
        await tx.update(members).set({ userId: remove.userId, updatedAt: now }).where(eq(members.id, keepId));
      }

      // 消える側は残す（行は消さない）。サジェスト・検索には出なくなる
      await tx
        .update(members)
        .set({ status: "merged", mergedIntoId: keepId, userId: null, updatedAt: now })
        .where(eq(members.id, removeId));

      // 残す側の参加回数・最終参加日を数え直す（取消・削除済みの申込は数えない）
      const [counted] = await tx
        .select({ count: sql<number>`count(*)::int`, last: sql<string | null>`max(${entries.submittedAt})` })
        .from(entryPlayers)
        .innerJoin(entries, and(eq(entries.associationId, entryPlayers.associationId), eq(entries.id, entryPlayers.entryId)))
        .where(
          and(
            eq(entryPlayers.associationId, associationId),
            eq(entryPlayers.memberId, keepId),
            eq(entries.status, "submitted"),
            isNull(entries.deletedAt),
          ),
        );
      await tx
        .update(members)
        .set({
          entryCount: counted?.count ?? 0,
          lastEntryAt: counted?.last ? new Date(counted.last) : null,
          // まとめた結果、確認の必要はなくなる
          status: "active",
          updatedAt: now,
        })
        .where(eq(members.id, keepId));

      await logAdminAccess(tx, { userId: principal.userId, associationId, action: "merge_members", targetId: removeId });
    },
    { userId: principal.userId },
  );
}
