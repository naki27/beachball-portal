import { and, count, desc, eq, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  contactMessages,
  deletionLogs,
  memberAliases,
  members,
  teamAdmins,
  teamInvitations,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { subjectLabel } from "@/lib/contact-subjects";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { countOpenEntries } from "@/lib/repo/entries";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 削除済みデータと物理削除（設計書 §5.16）。テナント管理者だけ（§3.2 physicalDelete）
// 表ごとの扱いはこのファイルの TRASH_TABLES だけに書く。1b・1c の表はここに足す（B-17・C-03）
// - 復元: deleted_at / deleted_by を消す。親が削除済みのままなら復元させない
// - 物理削除: 論理削除済みだけ。1 トランザクションで、子は外部キーの cascade に任せる
// - deletion_logs には表名・ID・一緒に消えた件数・理由・実行者だけを残す（中身は記録しない）

export const TRASH_TABLE_KEYS = ["teams", "team_members", "members", "contact_messages"] as const;

export type TrashTable = (typeof TRASH_TABLE_KEYS)[number];

export function isTrashTable(value: string): value is TrashTable {
  return (TRASH_TABLE_KEYS as readonly string[]).includes(value);
}

export type TrashItem = {
  id: string;
  // 画面に出す見出し（内部の用語は出さない・§4.4）
  title: string;
  detail: string;
  deletedAt: Date;
  deletedByName: string | null;
  // 復元できない理由（親が削除済みのまま）。なければ null
  restoreBlockedBy: string | null;
  // 物理削除で一緒に消えるものの説明（2 段階の確認に出す）
  cascade: string;
};

type TrashDefinition = {
  key: TrashTable;
  // 画面の呼び名（§4.4）
  label: string;
  // 削除済みの一覧（新しい順）
  list: (tx: Tx, associationId: string) => Promise<TrashItem[]>;
  // 件数
  countDeleted: (tx: Tx, associationId: string) => Promise<number>;
  // 復元。できなければ TeamError
  restore: (tx: Tx, associationId: string, id: string) => Promise<void>;
  // 物理削除。一緒に消えた件数を返す
  purge: (tx: Tx, associationId: string, id: string, now: Date) => Promise<number>;
};

function deletedByName(row: { deletedByName: string | null; deletedByEmail: string | null }): string | null {
  return row.deletedByName ?? null;
}

// 削除済みの行を 1 件だけ読む（物理削除・復元の前の確認）
async function requireDeleted<T extends { deletedAt: Date | null }>(row: T | undefined, what: string): Promise<T> {
  if (!row) throw new TeamError(404, `${what}が見つかりません`);
  if (!row.deletedAt) throw new TeamError(409, "削除していないものは、完全に削除できません");
  return row;
}

const teamsDefinition: TrashDefinition = {
  key: "teams",
  label: "チーム",
  countDeleted: async (tx, associationId) => {
    const [row] = await tx
      .select({ n: count() })
      .from(teams)
      .where(and(eq(teams.associationId, associationId), isNotNull(teams.deletedAt)));
    return row?.n ?? 0;
  },
  list: async (tx, associationId) => {
    const rows = await tx
      .select({
        id: teams.id,
        name: teams.name,
        kind: teams.kind,
        deletedAt: teams.deletedAt,
        deletedByName: users.displayName,
        deletedByEmail: users.email,
      })
      .from(teams)
      .leftJoin(users, eq(users.id, teams.deletedBy))
      .where(and(eq(teams.associationId, associationId), isNotNull(teams.deletedAt)))
      .orderBy(desc(teams.deletedAt));
    return Promise.all(
      rows.map(async (row) => {
        const [players] = await tx
          .select({ n: count() })
          .from(teamMembers)
          .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.teamId, row.id)));
        return {
          id: row.id,
          title: row.name,
          detail: `${row.kind === "individual" ? "個人の登録" : "チーム"}・選手一覧の行 ${players?.n ?? 0} 件`,
          deletedAt: row.deletedAt as Date,
          deletedByName: deletedByName(row),
          restoreBlockedBy: null,
          cascade: "このチームの選手一覧の行・代表者の記録・招待も消えます（選手の人物は残ります）",
        };
      }),
    );
  },
  restore: async (tx, associationId, id) => {
    const rows = await tx
      .update(teams)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(and(eq(teams.associationId, associationId), eq(teams.id, id), isNotNull(teams.deletedAt)))
      .returning({ id: teams.id });
    if (rows.length === 0) throw new TeamError(404, "チームが見つかりません");
  },
  purge: async (tx, associationId, id, now) => {
    const [team] = await tx
      .select({ id: teams.id, deletedAt: teams.deletedAt })
      .from(teams)
      .where(and(eq(teams.associationId, associationId), eq(teams.id, id)))
      .limit(1);
    await requireDeleted(team, "チーム");
    // 申込が残っているチームは消せない（§5.16。申込は大会の記録として残すため）
    if ((await countOpenEntries(tx, associationId, id, now)) > 0) {
      throw new TeamError(409, "申し込みが残っています。先に申し込みを完全に削除してください");
    }
    const cascaded = await countRows([
      tx.select({ n: count() }).from(teamMembers).where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.teamId, id))),
      tx.select({ n: count() }).from(teamAdmins).where(and(eq(teamAdmins.associationId, associationId), eq(teamAdmins.teamId, id))),
      tx.select({ n: count() }).from(teamInvitations).where(and(eq(teamInvitations.associationId, associationId), eq(teamInvitations.teamId, id))),
    ]);
    await tx.delete(teams).where(and(eq(teams.associationId, associationId), eq(teams.id, id)));
    return cascaded;
  },
};

const teamMembersDefinition: TrashDefinition = {
  key: "team_members",
  label: "選手一覧の行",
  countDeleted: async (tx, associationId) => {
    const [row] = await tx
      .select({ n: count() })
      .from(teamMembers)
      .where(and(eq(teamMembers.associationId, associationId), isNotNull(teamMembers.deletedAt)));
    return row?.n ?? 0;
  },
  list: async (tx, associationId) => {
    const rows = await tx
      .select({
        id: teamMembers.id,
        memberName: members.name,
        teamName: teams.name,
        teamDeletedAt: teams.deletedAt,
        memberDeletedAt: members.deletedAt,
        deletedAt: teamMembers.deletedAt,
        deletedByName: users.displayName,
        deletedByEmail: users.email,
      })
      .from(teamMembers)
      .innerJoin(members, and(eq(members.associationId, associationId), eq(members.id, teamMembers.memberId)))
      .innerJoin(teams, and(eq(teams.associationId, associationId), eq(teams.id, teamMembers.teamId)))
      .leftJoin(users, eq(users.id, teamMembers.deletedBy))
      .where(and(eq(teamMembers.associationId, associationId), isNotNull(teamMembers.deletedAt)))
      .orderBy(desc(teamMembers.deletedAt));
    return rows.map((row) => ({
      id: row.id,
      title: `${row.memberName}（${row.teamName}）`,
      detail: "チームの選手一覧に載っていた行",
      deletedAt: row.deletedAt as Date,
      deletedByName: deletedByName(row),
      restoreBlockedBy: row.teamDeletedAt
        ? "チームが削除されています。先にチームを復元してください"
        : row.memberDeletedAt
          ? "この方の登録が削除されています。先に登録を復元してください"
          : null,
      cascade: "この行だけが消えます（人物とチームは残ります）",
    }));
  },
  restore: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ teamDeletedAt: teams.deletedAt, memberDeletedAt: members.deletedAt })
      .from(teamMembers)
      .innerJoin(members, and(eq(members.associationId, associationId), eq(members.id, teamMembers.memberId)))
      .innerJoin(teams, and(eq(teams.associationId, associationId), eq(teams.id, teamMembers.teamId)))
      .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.id, id), isNotNull(teamMembers.deletedAt)))
      .limit(1);
    if (!row) throw new TeamError(404, "選手一覧の行が見つかりません");
    if (row.teamDeletedAt) throw new TeamError(409, "チームが削除されています。先にチームを復元してください");
    if (row.memberDeletedAt) throw new TeamError(409, "この方の登録が削除されています。先に登録を復元してください");
    await tx
      .update(teamMembers)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.id, id)));
  },
  purge: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ id: teamMembers.id, deletedAt: teamMembers.deletedAt })
      .from(teamMembers)
      .where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.id, id)))
      .limit(1);
    await requireDeleted(row, "選手一覧の行");
    await tx.delete(teamMembers).where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.id, id)));
    return 0;
  },
};

const membersDefinition: TrashDefinition = {
  key: "members",
  label: "登録（選手）",
  countDeleted: async (tx, associationId) => {
    const [row] = await tx
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.associationId, associationId), isNotNull(members.deletedAt)));
    return row?.n ?? 0;
  },
  list: async (tx, associationId) => {
    const rows = await tx
      .select({
        id: members.id,
        name: members.name,
        entryCount: members.entryCount,
        deletedAt: members.deletedAt,
        deletedByName: users.displayName,
        deletedByEmail: users.email,
      })
      .from(members)
      .leftJoin(users, eq(users.id, members.deletedBy))
      .where(and(eq(members.associationId, associationId), isNotNull(members.deletedAt)))
      .orderBy(desc(members.deletedAt));
    return rows.map((row) => ({
      id: row.id,
      title: row.name,
      // 生年月日は出さない（§12。削除済みの一覧でも同じ）
      detail: `申し込み ${row.entryCount} 件`,
      deletedAt: row.deletedAt as Date,
      deletedByName: deletedByName(row),
      restoreBlockedBy: null,
      cascade: "この方の選手一覧の行・別の書き方の記録・返事待ちの招待も消えます",
    }));
  },
  restore: async (tx, associationId, id) => {
    const rows = await tx
      .update(members)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(and(eq(members.associationId, associationId), eq(members.id, id), isNotNull(members.deletedAt)))
      .returning({ id: members.id });
    if (rows.length === 0) throw new TeamError(404, "登録が見つかりません");
  },
  purge: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ id: members.id, deletedAt: members.deletedAt, entryCount: members.entryCount })
      .from(members)
      .where(and(eq(members.associationId, associationId), eq(members.id, id)))
      .limit(1);
    const member = await requireDeleted(row, "登録");
    // 申込に出ている人の扱い（entry_players の書き換え）は B-17
    if (member.entryCount > 0) {
      throw new TeamError(409, "申し込みに出ている方は、まだ完全に削除できません");
    }
    // まとめ先にされている人物があると消せない（人物の統合は B-15）
    const [merged] = await tx
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.associationId, associationId), eq(members.mergedIntoId, id), ne(members.id, id)));
    if ((merged?.n ?? 0) > 0) {
      throw new TeamError(409, "ほかの登録のまとめ先になっています。先にそちらを直してください");
    }
    const cascaded = await countRows([
      tx.select({ n: count() }).from(teamMembers).where(and(eq(teamMembers.associationId, associationId), eq(teamMembers.memberId, id))),
      tx.select({ n: count() }).from(memberAliases).where(and(eq(memberAliases.associationId, associationId), eq(memberAliases.memberId, id))),
      tx.select({ n: count() }).from(teamInvitations).where(and(eq(teamInvitations.associationId, associationId), eq(teamInvitations.memberId, id))),
    ]);
    await tx.delete(members).where(and(eq(members.associationId, associationId), eq(members.id, id)));
    return cascaded;
  },
};

const contactMessagesDefinition: TrashDefinition = {
  key: "contact_messages",
  label: "お問い合わせ",
  countDeleted: async (tx, associationId) => {
    const [row] = await tx
      .select({ n: count() })
      .from(contactMessages)
      .where(and(eq(contactMessages.associationId, associationId), isNotNull(contactMessages.deletedAt)));
    return row?.n ?? 0;
  },
  list: async (tx, associationId) => {
    const rows = await tx
      .select({
        id: contactMessages.id,
        subjectType: contactMessages.subjectType,
        senderName: contactMessages.senderName,
        createdAt: contactMessages.createdAt,
        deletedAt: contactMessages.deletedAt,
        deletedByName: users.displayName,
        deletedByEmail: users.email,
      })
      .from(contactMessages)
      .leftJoin(users, eq(users.id, contactMessages.deletedBy))
      .where(and(eq(contactMessages.associationId, associationId), isNotNull(contactMessages.deletedAt)))
      .orderBy(desc(contactMessages.deletedAt));
    return rows.map((row) => ({
      id: row.id,
      title: `${subjectLabel(row.subjectType)}（${row.senderName}）`,
      detail: `${formatDateWithWeekday(todayInTokyo(row.createdAt))}に届いたお問い合わせ`,
      deletedAt: row.deletedAt as Date,
      deletedByName: deletedByName(row),
      restoreBlockedBy: null,
      cascade: "このお問い合わせだけが消えます",
    }));
  },
  restore: async (tx, associationId, id) => {
    const rows = await tx
      .update(contactMessages)
      .set({ deletedAt: null, deletedBy: null })
      .where(
        and(eq(contactMessages.associationId, associationId), eq(contactMessages.id, id), isNotNull(contactMessages.deletedAt)),
      )
      .returning({ id: contactMessages.id });
    if (rows.length === 0) throw new TeamError(404, "お問い合わせが見つかりません");
  },
  purge: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ id: contactMessages.id, deletedAt: contactMessages.deletedAt })
      .from(contactMessages)
      .where(and(eq(contactMessages.associationId, associationId), eq(contactMessages.id, id)))
      .limit(1);
    await requireDeleted(row, "お問い合わせ");
    await tx.delete(contactMessages).where(and(eq(contactMessages.associationId, associationId), eq(contactMessages.id, id)));
    return 0;
  },
};

export const TRASH_TABLES: Record<TrashTable, TrashDefinition> = {
  teams: teamsDefinition,
  team_members: teamMembersDefinition,
  members: membersDefinition,
  contact_messages: contactMessagesDefinition,
};

export const TRASH_LABEL: Record<TrashTable, string> = {
  teams: teamsDefinition.label,
  team_members: teamMembersDefinition.label,
  members: membersDefinition.label,
  contact_messages: contactMessagesDefinition.label,
};

// 一緒に消える行の数（deletion_logs の cascaded_count）。消す前に数える
async function countRows(queries: Promise<{ n: number }[]>[]): Promise<number> {
  const results = await Promise.all(queries);
  return results.reduce((total, rows) => total + (rows[0]?.n ?? 0), 0);
}

function assertId(id: string): void {
  if (!isUuid(id)) throw new TeamError(404, "見つかりません");
}

export type TrashCounts = Record<TrashTable, number>;

export async function countTrash(db: Db, principal: Principal & { userId: string }, associationId: string): Promise<TrashCounts> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const entries = await Promise.all(
        TRASH_TABLE_KEYS.map(async (key) => [key, await TRASH_TABLES[key].countDeleted(tx, associationId)] as const),
      );
      return Object.fromEntries(entries) as TrashCounts;
    },
    { userId: principal.userId },
  );
}

export async function listTrash(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  table: TrashTable,
): Promise<TrashItem[]> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      return TRASH_TABLES[table].list(tx, associationId);
    },
    { userId: principal.userId },
  );
}

// 復元（§5.16）。削除済みでなければ 404
export async function restoreFromTrash(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  table: TrashTable,
  id: string,
): Promise<void> {
  assertId(id);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      await TRASH_TABLES[table].restore(tx, associationId, id);
    },
    { userId: principal.userId },
  );
}

export const PURGE_REASON_MAX = 200;

// 物理削除（§5.16）。論理削除済みだけ。1 トランザクションで消し、deletion_logs に記録を残す（中身は残さない）
export async function purgeFromTrash(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  table: TrashTable,
  id: string,
  reason: string,
  now: Date = new Date(),
): Promise<{ cascadedCount: number }> {
  assertId(id);
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new TeamError(400, "完全に削除する理由を入力してください");
  if (trimmedReason.length > PURGE_REASON_MAX) throw new TeamError(400, "理由が長すぎます");

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const cascadedCount = await TRASH_TABLES[table].purge(tx, associationId, id, now);
      await tx.insert(deletionLogs).values({
        associationId,
        tableName: table,
        recordId: id,
        cascadedCount,
        reason: trimmedReason,
        deletedBy: principal.userId,
        deletedAt: now,
      });
      return { cascadedCount };
    },
    { userId: principal.userId },
  );
}
