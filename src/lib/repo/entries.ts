import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { entries, entryPlayers, type EntryPlayerMatchType, type MemberSex, tournamentCategories, tournaments } from "@/db/schema";
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
