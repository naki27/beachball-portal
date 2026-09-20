import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  entries,
  entryAudits,
  type EntryAuditAction,
  entryPlayers,
  type EntryStatus,
  type EntryPlayerMatchType,
  type MemberSex,
  tournamentCategories,
  tournaments,
} from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 申込（entries）のリポジトリ。申込の作成・変更は B-09 以降。ここには読み取りと、ほかのタスクが要る判定の口を置く

// 締切前で取り消していない申込の数（§5.11「チームの無効化と削除」: 残っていれば代表者は無効化・削除できない）
// 締切は「部 → 大会」のフォールバック（deadline.ts の effectiveDeadline と同じ規則を SQL で表す）
export async function countOpenEntries(tx: Tx, associationId: string, teamId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(entries)
    .innerJoin(
      tournamentCategories,
      and(eq(tournamentCategories.associationId, entries.associationId), eq(tournamentCategories.id, entries.categoryId)),
    )
    .innerJoin(tournaments, and(eq(tournaments.associationId, entries.associationId), eq(tournaments.id, entries.tournamentId)))
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.teamId, teamId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
        sql`coalesce(${tournamentCategories.entryEndAt}, ${tournaments.entryEndAt}) >= ${now}`,
      ),
    );
  return row?.value ?? 0;
}

// 参加チーム一覧（§5.6）。**部とチーム名だけ**。選手の情報はこの関数の戻り値に入れない
export type PublicEntryTeam = { categoryId: string; teamName: string };

export async function listPublicEntryTeams(tx: Tx, associationId: string, tournamentId: string): Promise<PublicEntryTeam[]> {
  return tx
    .select({ categoryId: entries.categoryId, teamName: entries.teamName })
    .from(entries)
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(asc(entries.teamName), asc(entries.submittedAt))
    .limit(1000);
}

// 大会ごとの申込の数（一覧の「◯チーム」）。取り消し・削除済みは数えない
export async function countEntriesByTournament(tx: Tx, associationId: string, tournamentIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>(tournamentIds.map((id) => [id, 0]));
  if (tournamentIds.length === 0) return result;
  const rows = await tx
    .select({ tournamentId: entries.tournamentId, value: sql<number>`count(*)::int` })
    .from(entries)
    .where(and(eq(entries.associationId, associationId), eq(entries.status, "submitted"), isNull(entries.deletedAt)))
    .groupBy(entries.tournamentId);
  for (const row of rows) if (result.has(row.tournamentId)) result.set(row.tournamentId, row.value);
  return result;
}

// --- 申込の作成（B-10・§5.5(c)） ---

export type NewEntry = {
  tournamentId: string;
  categoryId: string;
  teamId: string;
  createdBy: string;
  teamName: string;
  note: string | null;
  needsAdminCheck: boolean;
  submitToken: string;
};

export type Entry = typeof entries.$inferSelect;

export async function insertEntry(tx: Tx, associationId: string, input: NewEntry): Promise<Entry> {
  const [row] = await tx
    .insert(entries)
    .values({ associationId, ...input })
    .returning();
  return row;
}

// 同じワンタイムの値で作られた申込（二重送信・「戻る」からの再送）。あればそれを返して 2 件目を作らない
export async function findEntryBySubmitToken(tx: Tx, associationId: string, submitToken: string): Promise<Entry | null> {
  const [row] = await tx
    .select()
    .from(entries)
    .where(and(eq(entries.associationId, associationId), eq(entries.submitToken, submitToken)))
    .limit(1);
  return row ?? null;
}

export type NewEntryPlayer = {
  position: number;
  name: string;
  kana: string | null;
  birthDate: string;
  sex: MemberSex;
  ageAtEvent: number;
  nameNormalized: string;
  kanaNormalized: string | null;
  memberId: string;
  matchType: EntryPlayerMatchType;
};

export async function insertEntryPlayers(tx: Tx, associationId: string, entryId: string, players: NewEntryPlayer[]): Promise<void> {
  if (players.length === 0) return;
  await tx.insert(entryPlayers).values(players.map((player) => ({ associationId, entryId, ...player })));
}

// 申込上限の判定（§5.4「申込上限」）。数える前に大会の行をロックして 1 件ずつ処理する
// 数えるのは status = submitted で削除されていない申込だけ（取消は数えない）
export async function lockTournamentForEntry(tx: Tx, associationId: string, tournamentId: string): Promise<void> {
  await tx.execute(
    sql`select 1 from tournaments where association_id = ${associationId} and id = ${tournamentId} for update`,
  );
}

export async function countSubmittedEntries(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  categoryId?: string,
): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(entries)
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        categoryId ? eq(entries.categoryId, categoryId) : undefined,
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    );
  return row?.value ?? 0;
}

// 同じ大会の別の申込に、同じ人物が登録されているか（警告・§5.5「警告と運営の確認対象の印」）
// 部・チームが違っても対象。エラーにはしない
export type DuplicatePlayer = { memberId: string; name: string; teamName: string; categoryLabel: string };

export async function listDuplicatePlayersInTournament(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  memberIds: string[],
  excludeEntryId?: string,
): Promise<DuplicatePlayer[]> {
  if (memberIds.length === 0) return [];
  return tx
    .select({
      memberId: sql<string>`${entryPlayers.memberId}`,
      name: entryPlayers.name,
      teamName: entries.teamName,
      categoryLabel: tournamentCategories.label,
    })
    .from(entryPlayers)
    .innerJoin(entries, and(eq(entries.associationId, entryPlayers.associationId), eq(entries.id, entryPlayers.entryId)))
    .innerJoin(
      tournamentCategories,
      and(eq(tournamentCategories.associationId, entries.associationId), eq(tournamentCategories.id, entries.categoryId)),
    )
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
        inArray(entryPlayers.memberId, memberIds),
        excludeEntryId ? ne(entries.id, excludeEntryId) : undefined,
      ),
    );
}

// 同じチームが同じ部にすでに申し込んでいるか（警告・§5.5）
export async function hasEntryForTeamAndCategory(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  teamId: string,
  categoryId: string,
  excludeEntryId?: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        eq(entries.teamId, teamId),
        eq(entries.categoryId, categoryId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
        excludeEntryId ? ne(entries.id, excludeEntryId) : undefined,
      ),
    )
    .limit(1);
  return !!row;
}

// --- 申込の参照（B-10 の完了ページ・メール。変更は B-12） ---

export type EntryPlayerRow = {
  id: string;
  position: number;
  name: string;
  kana: string | null;
  birthDate: string | null; // 物理削除で匿名化された申込は NULL（§5.16）
  sex: MemberSex;
  ageAtEvent: number | null;
  memberId: string | null;
};

export async function findEntry(tx: Tx, associationId: string, entryId: string): Promise<Entry | null> {
  const [row] = await tx
    .select()
    .from(entries)
    .where(and(eq(entries.associationId, associationId), eq(entries.id, entryId), isNull(entries.deletedAt)))
    .limit(1);
  return row ?? null;
}

export function listEntryPlayers(tx: Tx, associationId: string, entryId: string): Promise<EntryPlayerRow[]> {
  return tx
    .select({
      id: entryPlayers.id,
      position: entryPlayers.position,
      name: entryPlayers.name,
      kana: entryPlayers.kana,
      birthDate: entryPlayers.birthDate,
      sex: entryPlayers.sex,
      ageAtEvent: entryPlayers.ageAtEvent,
      memberId: entryPlayers.memberId,
    })
    .from(entryPlayers)
    .where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.entryId, entryId)))
    .orderBy(asc(entryPlayers.position));
}

// --- 前回コピー（B-11・§5.5(b)） ---

// そのチームの直近の申込（取消・削除でないもの）。部は `code` で突合するので、表示名は画面の説明にだけ使う
export type LatestTeamEntry = {
  entryId: string;
  tournamentId: string;
  tournamentName: string;
  categoryCode: string;
  categoryLabel: string;
  status: EntryStatus;
  submittedAt: Date;
};

export async function findLatestEntryForTeam(tx: Tx, associationId: string, teamId: string): Promise<LatestTeamEntry | null> {
  const [row] = await tx
    .select({
      entryId: entries.id,
      tournamentId: entries.tournamentId,
      tournamentName: tournaments.name,
      categoryCode: tournamentCategories.code,
      categoryLabel: tournamentCategories.label,
      status: entries.status,
      submittedAt: entries.submittedAt,
    })
    .from(entries)
    .innerJoin(tournaments, and(eq(tournaments.associationId, entries.associationId), eq(tournaments.id, entries.tournamentId)))
    .innerJoin(
      tournamentCategories,
      and(eq(tournamentCategories.associationId, entries.associationId), eq(tournamentCategories.id, entries.categoryId)),
    )
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.teamId, teamId),
        isNull(entries.deletedAt),
        isNull(tournaments.deletedAt),
      ),
    )
    // 取り消していない申込を先に。なければ取り消した申込から戻す（ADR 0025・§5.5(d)）
    .orderBy(sql`case when ${entries.status} = 'submitted' then 0 else 1 end`, desc(entries.submittedAt))
    .limit(1);
  return row ?? null;
}

// --- 申込の変更・取消（B-12・§5.5(d)） ---

export type EntryChanges = { categoryId: string; teamName: string; note: string | null; needsAdminCheck: boolean };

export async function updateEntryRow(
  tx: Tx,
  associationId: string,
  entryId: string,
  changes: EntryChanges,
  updatedBy: string,
  at: Date,
): Promise<void> {
  await tx
    .update(entries)
    .set({ ...changes, updatedBy, updatedAt: at })
    .where(and(eq(entries.associationId, associationId), eq(entries.id, entryId)));
}

// 取消は status（物理削除しない・§5.5(d)）。元には戻せない
export async function cancelEntryRow(tx: Tx, associationId: string, entryId: string, updatedBy: string, at: Date): Promise<void> {
  await tx
    .update(entries)
    .set({ status: "cancelled", cancelledAt: at, updatedBy, updatedAt: at })
    .where(and(eq(entries.associationId, associationId), eq(entries.id, entryId)));
}

// 変更のたびに選手の行は入れ替える（申込時点のスナップショットを作り直す・§5.5）
export async function deleteEntryPlayers(tx: Tx, associationId: string, entryId: string): Promise<void> {
  await tx.delete(entryPlayers).where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.entryId, entryId)));
}

// 変更履歴（§5.5(d)）。**生年月日は入れない**（§5.16）
export async function insertEntryAudit(
  tx: Tx,
  associationId: string,
  input: {
    entryId: string;
    actorId: string | null;
    action: EntryAuditAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
): Promise<void> {
  await tx.insert(entryAudits).values({ associationId, ...input });
}

// --- 管理画面の申込一覧・CSV（B-13・§5.5(f)） ---

export type AdminEntryRow = {
  entryId: string;
  categoryId: string;
  categoryCode: string;
  categoryLabel: string;
  categorySortOrder: number;
  teamId: string;
  teamName: string;
  note: string | null;
  needsAdminCheck: boolean;
  submittedAt: Date;
  updatedAt: Date;
};

// 取消済み・削除済みは出さない（§5.5(f)）。並びは 部 → 申込日時
export function listEntriesForAdmin(tx: Tx, associationId: string, tournamentId: string): Promise<AdminEntryRow[]> {
  return tx
    .select({
      entryId: entries.id,
      categoryId: entries.categoryId,
      categoryCode: tournamentCategories.code,
      categoryLabel: tournamentCategories.label,
      categorySortOrder: tournamentCategories.sortOrder,
      teamId: entries.teamId,
      teamName: entries.teamName,
      note: entries.note,
      needsAdminCheck: entries.needsAdminCheck,
      submittedAt: entries.submittedAt,
      updatedAt: entries.updatedAt,
    })
    .from(entries)
    .innerJoin(
      tournamentCategories,
      and(eq(tournamentCategories.associationId, entries.associationId), eq(tournamentCategories.id, entries.categoryId)),
    )
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(asc(tournamentCategories.sortOrder), asc(tournamentCategories.code), asc(entries.submittedAt))
    .limit(5000);
}

// 大会に出る申込の選手をまとめて読む（1 選手 1 行の CSV・一覧の人数）
export type AdminEntryPlayerRow = EntryPlayerRow & { entryId: string };

export function listEntryPlayersForTournament(tx: Tx, associationId: string, tournamentId: string): Promise<AdminEntryPlayerRow[]> {
  return tx
    .select({
      entryId: entryPlayers.entryId,
      id: entryPlayers.id,
      position: entryPlayers.position,
      name: entryPlayers.name,
      kana: entryPlayers.kana,
      birthDate: entryPlayers.birthDate,
      sex: entryPlayers.sex,
      ageAtEvent: entryPlayers.ageAtEvent,
      memberId: entryPlayers.memberId,
    })
    .from(entryPlayers)
    .innerJoin(entries, and(eq(entries.associationId, entryPlayers.associationId), eq(entries.id, entryPlayers.entryId)))
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(asc(entryPlayers.entryId), asc(entryPlayers.position))
    .limit(20000);
}

// 「確認済み」（運営の確認対象の印を外す・§5.5）
export async function clearNeedsAdminCheck(tx: Tx, associationId: string, entryId: string, updatedBy: string, at: Date): Promise<void> {
  await tx
    .update(entries)
    .set({ needsAdminCheck: false, updatedBy, updatedAt: at })
    .where(and(eq(entries.associationId, associationId), eq(entries.id, entryId)));
}

// --- マイページ・「あなたのやること」（B-16・§5.3・§5.17） ---

export type MyEntryRow = {
  entryId: string;
  tournamentId: string;
  tournamentName: string;
  categoryId: string;
  categoryLabel: string;
  teamId: string;
  teamName: string;
  status: EntryStatus;
  submittedAt: Date;
  // 締切は「部 → 大会」のフォールバック（deadline.ts と同じ規則）
  entryEndAt: Date;
  eventDate: string | null;
};

const MY_ENTRY_COLUMNS = {
  entryId: entries.id,
  tournamentId: entries.tournamentId,
  tournamentName: tournaments.name,
  categoryId: entries.categoryId,
  categoryLabel: tournamentCategories.label,
  teamId: entries.teamId,
  teamName: entries.teamName,
  status: entries.status,
  submittedAt: entries.submittedAt,
  entryEndAt: sql<Date>`coalesce(${tournamentCategories.entryEndAt}, ${tournaments.entryEndAt})`,
  eventDate: tournaments.eventDate,
};

function myEntries(tx: Tx) {
  return tx
    .select(MY_ENTRY_COLUMNS)
    .from(entries)
    .innerJoin(tournaments, and(eq(tournaments.associationId, entries.associationId), eq(tournaments.id, entries.tournamentId)))
    .innerJoin(
      tournamentCategories,
      and(eq(tournamentCategories.associationId, entries.associationId), eq(tournamentCategories.id, entries.categoryId)),
    );
}

// 代表者として操作できる申込（そのチームの申込。取消も出す）
export async function listEntriesForTeams(tx: Tx, associationId: string, teamIds: string[]): Promise<MyEntryRow[]> {
  if (teamIds.length === 0) return [];
  return myEntries(tx)
    .where(and(eq(entries.associationId, associationId), inArray(entries.teamId, teamIds), isNull(entries.deletedAt)))
    .orderBy(desc(entries.submittedAt))
    .limit(200);
}

// 選手として出る申込（自分の人物が選手として入っているもの。取消は出さない）
export async function listEntriesForMember(tx: Tx, associationId: string, memberId: string): Promise<MyEntryRow[]> {
  return myEntries(tx)
    .innerJoin(entryPlayers, and(eq(entryPlayers.associationId, entries.associationId), eq(entryPlayers.entryId, entries.id)))
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entryPlayers.memberId, memberId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(desc(entries.submittedAt))
    .limit(200);
}

// 申込の論理削除（§5.16。誤登録の取り消し。取消（status = cancelled）とは別物）
export async function softDeleteEntry(tx: Tx, associationId: string, entryId: string, deletedBy: string, at: Date): Promise<boolean> {
  const rows = await tx
    .update(entries)
    .set({ deletedAt: at, deletedBy, updatedAt: at })
    .where(and(eq(entries.associationId, associationId), eq(entries.id, entryId), isNull(entries.deletedAt)))
    .returning({ id: entries.id });
  return rows.length > 0;
}

// そのチームの申込の数（取消も含む。削除済みは除く）。申込が 1 件でもあるチームは物理削除できない（§5.16）
export async function countEntriesForTeam(tx: Tx, associationId: string, teamId: string): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(entries)
    .where(and(eq(entries.associationId, associationId), eq(entries.teamId, teamId), isNull(entries.deletedAt)));
  return row?.value ?? 0;
}
