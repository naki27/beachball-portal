import { and, count, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  contactMessages,
  deletionLogs,
  entries,
  entryAudits,
  entryPlayers,
  memberAliases,
  members,
  memberships,
  teamAdmins,
  teamInvitations,
  teamMembers,
  teams,
  tournamentCategories,
  tournaments,
  users,
} from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { subjectLabel } from "@/lib/contact-subjects";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { syncTournamentDocuments } from "@/lib/documents/publish";
import { listKeysForTournament } from "@/lib/repo/tournament-documents";
import { countEntriesForTeam } from "@/lib/repo/entries";
import { getStorage } from "@/lib/storage";
import type { StorageAdapter } from "@/lib/storage/types";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";
import { DELETED_NAME, PURGE_REASON_LABEL, type PurgeReasonKind } from "./purge-reasons";

export { isPurgeReasonKind, PURGE_REASON_KEYS, PURGE_REASON_LABEL, type PurgeReasonKind } from "./purge-reasons";

// 削除済みデータと物理削除（設計書 §5.16）。テナント管理者だけ（§3.2 physicalDelete）
// 表ごとの扱いはこのファイルの TRASH_TABLES だけに書く。1b・1c の表はここに足す（B-17・C-03）
// - 復元: deleted_at / deleted_by を消す。親が削除済みのままなら復元させない
// - 物理削除: 論理削除済みだけ。1 トランザクションで、子は外部キーの cascade に任せる
// - deletion_logs には表名・ID・一緒に消えた件数・理由・実行者だけを残す（中身は記録しない）

export const TRASH_TABLE_KEYS = [
  "teams",
  "team_members",
  "members",
  "tournaments",
  "tournament_categories",
  "entries",
  "contact_messages",
] as const;

// 物理削除の理由と、申込の記録に残す「消した人」の書き方は purge-reasons.ts（画面からも読むため）

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
  // 復元。できなければ TeamError。storage は大会資料を公開用に戻すために渡す（§5.9）
  restore: (tx: Tx, associationId: string, id: string, storage: StorageAdapter) => Promise<void>;
  // 物理削除。一緒に消えた件数を返す。storage は大会資料のファイルを消すために渡す（消し損ねは日次ジョブ ⑥ が拾う・§5.16）
  purge: (tx: Tx, associationId: string, id: string, now: Date, reasonKind: PurgeReasonKind, storage: StorageAdapter) => Promise<number>;
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
  purge: async (tx, associationId, id) => {
    const [team] = await tx
      .select({ id: teams.id, deletedAt: teams.deletedAt })
      .from(teams)
      .where(and(eq(teams.associationId, associationId), eq(teams.id, id)))
      .limit(1);
    await requireDeleted(team, "チーム");
    // 申込が 1 件でも残っているチームは消せない（§5.16。申込は大会の記録として残すため）
    if ((await countEntriesForTeam(tx, associationId, id)) > 0) {
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
  purge: async (tx, associationId, id, _now, reasonKind) => {
    const [row] = await tx
      .select({ id: members.id, deletedAt: members.deletedAt, entryCount: members.entryCount })
      .from(members)
      .where(and(eq(members.associationId, associationId), eq(members.id, id)))
      .limit(1);
    await requireDeleted(row, "登録");
    // 申込そのものは大会の記録として残す。残し方は削除の理由で変わる（§5.16）
    await anonymizeEntryRecords(tx, associationId, id, reasonKind);
    // まとめ先にされている人物があると消せない（人物の統合は §5.8）
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
      tx.select({ n: count() }).from(memberships).where(and(eq(memberships.associationId, associationId), eq(memberships.memberId, id))),
    ]);
    await tx.delete(members).where(and(eq(members.associationId, associationId), eq(members.id, id)));
    return cascaded;
  },
};

// 人物を物理削除するときの申込の記録の扱い（§5.16。申込そのものは大会の記録として無期限に残す）
//   保存期間の満了 … 生年月日・正規化列・member_id を消す。氏名・ふりがな・性別・年齢は残す
//   本人の依頼・誤登録・その他 … 氏名・ふりがなも「（削除済み）」にする
// どちらの場合も、変更履歴（entry_audits）の JSON に残る氏名は「（削除済み）」に置き換える
async function anonymizeEntryRecords(
  tx: Tx,
  associationId: string,
  memberId: string,
  reasonKind: PurgeReasonKind,
): Promise<void> {
  const rows = await tx
    .select({ entryId: entryPlayers.entryId, name: entryPlayers.name, kana: entryPlayers.kana })
    .from(entryPlayers)
    .where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.memberId, memberId)));
  if (rows.length === 0) return;

  const keepName = reasonKind === "retention";
  await tx
    .update(entryPlayers)
    .set({
      birthDate: null,
      nameNormalized: "",
      kanaNormalized: null,
      memberId: null,
      matchType: "unmatched",
      ...(keepName ? {} : { name: DELETED_NAME, kana: null }),
    })
    .where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.memberId, memberId)));

  // 変更履歴の JSON に残る氏名（理由にかかわらず置き換える）
  const names = new Set(rows.flatMap((row) => [row.name, row.kana].filter((value): value is string => !!value)));
  const entryIds = [...new Set(rows.map((row) => row.entryId))];
  const audits = await tx
    .select({ id: entryAudits.id, before: entryAudits.before, after: entryAudits.after })
    .from(entryAudits)
    .where(and(eq(entryAudits.associationId, associationId), inArray(entryAudits.entryId, entryIds)));
  for (const audit of audits) {
    await tx
      .update(entryAudits)
      .set({ before: scrubNames(audit.before, names), after: scrubNames(audit.after, names) })
      .where(eq(entryAudits.id, audit.id));
  }
}

// JSON の中の氏名を「（削除済み）」に置き換える（入れ子の配列・オブジェクトもたどる）
function scrubNames<T>(value: T, names: ReadonlySet<string>): T {
  if (typeof value === "string") return (names.has(value) ? DELETED_NAME : value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubNames(item, names)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubNames(item, names)])) as T;
  }
  return value;
}

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

// --- 大会・部・申込（B-17・§5.16 の「物理削除で何が起きるか」の表） ---

const tournamentsDefinition: TrashDefinition = {
  key: "tournaments",
  label: "大会",
  countDeleted: async (tx, associationId) => {
    const [row] = await tx
      .select({ n: count() })
      .from(tournaments)
      .where(and(eq(tournaments.associationId, associationId), isNotNull(tournaments.deletedAt)));
    return row?.n ?? 0;
  },
  list: async (tx, associationId) => {
    const rows = await tx
      .select({
        id: tournaments.id,
        name: tournaments.name,
        eventDate: tournaments.eventDate,
        deletedAt: tournaments.deletedAt,
        deletedByName: users.displayName,
        deletedByEmail: users.email,
      })
      .from(tournaments)
      .leftJoin(users, eq(users.id, tournaments.deletedBy))
      .where(and(eq(tournaments.associationId, associationId), isNotNull(tournaments.deletedAt)))
      .orderBy(desc(tournaments.deletedAt));
    return Promise.all(
      rows.map(async (row) => {
        const [entryCount] = await tx
          .select({ n: count() })
          .from(entries)
          .where(and(eq(entries.associationId, associationId), eq(entries.tournamentId, row.id)));
        return {
          id: row.id,
          title: row.name,
          detail: `${row.eventDate ? `${row.eventDate} 開催・` : "開催日は未定・"}申し込み ${entryCount?.n ?? 0} 件`,
          deletedAt: row.deletedAt as Date,
          deletedByName: deletedByName(row),
          restoreBlockedBy: null,
          cascade: "この大会の部・申し込み（選手と変更履歴を含む）も消えます",
        };
      }),
    );
  },
  restore: async (tx, associationId, id, storage) => {
    const rows = await tx
      .update(tournaments)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(and(eq(tournaments.associationId, associationId), eq(tournaments.id, id), isNotNull(tournaments.deletedAt)))
      .returning({ id: tournaments.id, status: tournaments.status });
    if (rows.length === 0) throw new TeamError(404, "大会が見つかりません");
    // 削除したときに公開用から下ろした資料を、元の状態に戻す（§5.9）
    await syncTournamentDocuments(tx, storage, associationId, rows[0]);
  },
  purge: async (tx, associationId, id, _now, _reasonKind, storage) => {
    const [row] = await tx
      .select({ id: tournaments.id, deletedAt: tournaments.deletedAt })
      .from(tournaments)
      .where(and(eq(tournaments.associationId, associationId), eq(tournaments.id, id)))
      .limit(1);
    await requireDeleted(row, "大会");
    const entryIds = (
      await tx
        .select({ id: entries.id })
        .from(entries)
        .where(and(eq(entries.associationId, associationId), eq(entries.tournamentId, id)))
    ).map((entry) => entry.id);
    const cascaded = await countRows([
      tx
        .select({ n: count() })
        .from(tournamentCategories)
        .where(and(eq(tournamentCategories.associationId, associationId), eq(tournamentCategories.tournamentId, id))),
      tx.select({ n: count() }).from(entries).where(and(eq(entries.associationId, associationId), eq(entries.tournamentId, id))),
    ]);
    // 問い合わせは残し、大会・申込との紐づけだけ外す（§5.16 の表）
    await detachContacts(tx, associationId, entryIds, id);
    // 資料のファイルもここで消す。消し損ねても DB から指されなくなるので、日次ジョブ ⑥ が拾う（§5.16）
    const keys = await listKeysForTournament(tx, associationId, id);
    await tx.delete(tournaments).where(and(eq(tournaments.associationId, associationId), eq(tournaments.id, id)));
    for (const key of keys) {
      await storage.remove("private", key.storageKey).catch(() => undefined);
      if (key.publicKey) await storage.remove("public", key.publicKey).catch(() => undefined);
    }
    return cascaded;
  },
};

const tournamentCategoriesDefinition: TrashDefinition = {
  key: "tournament_categories",
  label: "大会の部",
  countDeleted: async (tx, associationId) => {
    const [row] = await tx
      .select({ n: count() })
      .from(tournamentCategories)
      .where(and(eq(tournamentCategories.associationId, associationId), isNotNull(tournamentCategories.deletedAt)));
    return row?.n ?? 0;
  },
  list: async (tx, associationId) => {
    const rows = await tx
      .select({
        id: tournamentCategories.id,
        label: tournamentCategories.label,
        tournamentName: tournaments.name,
        tournamentDeletedAt: tournaments.deletedAt,
        deletedAt: tournamentCategories.deletedAt,
        deletedByName: users.displayName,
        deletedByEmail: users.email,
      })
      .from(tournamentCategories)
      .innerJoin(tournaments, and(eq(tournaments.associationId, associationId), eq(tournaments.id, tournamentCategories.tournamentId)))
      .leftJoin(users, eq(users.id, tournamentCategories.deletedBy))
      .where(and(eq(tournamentCategories.associationId, associationId), isNotNull(tournamentCategories.deletedAt)))
      .orderBy(desc(tournamentCategories.deletedAt));
    return rows.map((row) => ({
      id: row.id,
      title: `${row.label}（${row.tournamentName}）`,
      detail: "大会から外した部",
      deletedAt: row.deletedAt as Date,
      deletedByName: deletedByName(row),
      restoreBlockedBy: row.tournamentDeletedAt ? "大会が削除されています。先に大会を復元してください" : null,
      cascade: "この部の申し込み（選手と変更履歴を含む）も消えます",
    }));
  },
  restore: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ tournamentDeletedAt: tournaments.deletedAt })
      .from(tournamentCategories)
      .innerJoin(tournaments, and(eq(tournaments.associationId, associationId), eq(tournaments.id, tournamentCategories.tournamentId)))
      .where(
        and(
          eq(tournamentCategories.associationId, associationId),
          eq(tournamentCategories.id, id),
          isNotNull(tournamentCategories.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new TeamError(404, "部が見つかりません");
    if (row.tournamentDeletedAt) throw new TeamError(409, "大会が削除されています。先に大会を復元してください");
    await tx
      .update(tournamentCategories)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(tournamentCategories.associationId, associationId), eq(tournamentCategories.id, id)));
  },
  purge: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ id: tournamentCategories.id, deletedAt: tournamentCategories.deletedAt })
      .from(tournamentCategories)
      .where(and(eq(tournamentCategories.associationId, associationId), eq(tournamentCategories.id, id)))
      .limit(1);
    await requireDeleted(row, "部");
    const entryIds = (
      await tx.select({ id: entries.id }).from(entries).where(and(eq(entries.associationId, associationId), eq(entries.categoryId, id)))
    ).map((entry) => entry.id);
    await detachContacts(tx, associationId, entryIds, null);
    await tx
      .delete(tournamentCategories)
      .where(and(eq(tournamentCategories.associationId, associationId), eq(tournamentCategories.id, id)));
    return entryIds.length;
  },
};

const entriesDefinition: TrashDefinition = {
  key: "entries",
  label: "申し込み",
  countDeleted: async (tx, associationId) => {
    const [row] = await tx
      .select({ n: count() })
      .from(entries)
      .where(and(eq(entries.associationId, associationId), isNotNull(entries.deletedAt)));
    return row?.n ?? 0;
  },
  list: async (tx, associationId) => {
    const rows = await tx
      .select({
        id: entries.id,
        teamName: entries.teamName,
        categoryLabel: tournamentCategories.label,
        tournamentName: tournaments.name,
        tournamentDeletedAt: tournaments.deletedAt,
        deletedAt: entries.deletedAt,
        deletedByName: users.displayName,
        deletedByEmail: users.email,
      })
      .from(entries)
      .innerJoin(tournaments, and(eq(tournaments.associationId, associationId), eq(tournaments.id, entries.tournamentId)))
      .innerJoin(
        tournamentCategories,
        and(eq(tournamentCategories.associationId, associationId), eq(tournamentCategories.id, entries.categoryId)),
      )
      .leftJoin(users, eq(users.id, entries.deletedBy))
      .where(and(eq(entries.associationId, associationId), isNotNull(entries.deletedAt)))
      .orderBy(desc(entries.deletedAt));
    return Promise.all(
      rows.map(async (row) => {
        const [players] = await tx
          .select({ n: count() })
          .from(entryPlayers)
          .where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.entryId, row.id)));
        return {
          id: row.id,
          title: `${row.teamName}（${row.tournamentName}・${row.categoryLabel}）`,
          // 選手の氏名・生年月日は出さない（§12。削除済みの一覧でも同じ）
          detail: `選手 ${players?.n ?? 0} 人`,
          deletedAt: row.deletedAt as Date,
          deletedByName: deletedByName(row),
          restoreBlockedBy: row.tournamentDeletedAt ? "大会が削除されています。先に大会を復元してください" : null,
          cascade: "この申し込みの選手と変更履歴も消えます",
        };
      }),
    );
  },
  restore: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ tournamentDeletedAt: tournaments.deletedAt })
      .from(entries)
      .innerJoin(tournaments, and(eq(tournaments.associationId, associationId), eq(tournaments.id, entries.tournamentId)))
      .where(and(eq(entries.associationId, associationId), eq(entries.id, id), isNotNull(entries.deletedAt)))
      .limit(1);
    if (!row) throw new TeamError(404, "申し込みが見つかりません");
    if (row.tournamentDeletedAt) throw new TeamError(409, "大会が削除されています。先に大会を復元してください");
    await tx
      .update(entries)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(and(eq(entries.associationId, associationId), eq(entries.id, id)));
  },
  purge: async (tx, associationId, id) => {
    const [row] = await tx
      .select({ id: entries.id, deletedAt: entries.deletedAt })
      .from(entries)
      .where(and(eq(entries.associationId, associationId), eq(entries.id, id)))
      .limit(1);
    await requireDeleted(row, "申し込み");
    const cascaded = await countRows([
      tx.select({ n: count() }).from(entryPlayers).where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.entryId, id))),
      tx.select({ n: count() }).from(entryAudits).where(and(eq(entryAudits.associationId, associationId), eq(entryAudits.entryId, id))),
    ]);
    await detachContacts(tx, associationId, [id], null);
    await tx.delete(entries).where(and(eq(entries.associationId, associationId), eq(entries.id, id)));
    return cascaded;
  },
};

// 問い合わせ・メールの記録は残し、消す申込・大会との紐づけだけ外す（§5.16 の表）
async function detachContacts(tx: Tx, associationId: string, entryIds: string[], tournamentId: string | null): Promise<void> {
  if (entryIds.length > 0) {
    await tx
      .update(contactMessages)
      .set({ entryId: null })
      .where(and(eq(contactMessages.associationId, associationId), inArray(contactMessages.entryId, entryIds)));
  }
  if (tournamentId) {
    await tx
      .update(contactMessages)
      .set({ tournamentId: null })
      .where(and(eq(contactMessages.associationId, associationId), eq(contactMessages.tournamentId, tournamentId)));
  }
}

export const TRASH_TABLES: Record<TrashTable, TrashDefinition> = {
  teams: teamsDefinition,
  team_members: teamMembersDefinition,
  members: membersDefinition,
  tournaments: tournamentsDefinition,
  tournament_categories: tournamentCategoriesDefinition,
  entries: entriesDefinition,
  contact_messages: contactMessagesDefinition,
};

export const TRASH_LABEL: Record<TrashTable, string> = Object.fromEntries(
  TRASH_TABLE_KEYS.map((key) => [key, TRASH_TABLES[key].label]),
) as Record<TrashTable, string>;

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
  storage: StorageAdapter = getStorage(),
): Promise<void> {
  assertId(id);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      await TRASH_TABLES[table].restore(tx, associationId, id, storage);
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
  // 人物を消すときの申込の記録の扱いが変わる（§5.16）。選ばれていなければ「その他」（氏名も消す側）
  reasonKind: PurgeReasonKind = "other",
  now: Date = new Date(),
  storage: StorageAdapter = getStorage(),
): Promise<{ cascadedCount: number }> {
  assertId(id);
  // 記録は「理由の種類：メモ」。「その他」はメモだけを残す
  const trimmedReason = [reasonKind === "other" ? "" : PURGE_REASON_LABEL[reasonKind], reason.trim()]
    .filter(Boolean)
    .join("：");
  if (!reason.trim()) throw new TeamError(400, "完全に削除する理由を入力してください");
  if (trimmedReason.length > PURGE_REASON_MAX) throw new TeamError(400, "理由が長すぎます");

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const cascadedCount = await TRASH_TABLES[table].purge(tx, associationId, id, now, reasonKind, storage);
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
