import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { categoryPresets, tournamentCategories, tournaments } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { endOfDayTokyo, formatPlainDate, parsePlainDate, startOfDayTokyo, type PlainDate } from "@/lib/date";
import type { TournamentInput, TournamentInputStatus } from "@/lib/tournaments/tournament-input";

// 大会のデータアクセス（設計書 §5.4・付録 A）。すべての関数が associationId を受け取り、削除済みは既定で除く
// 日付の列（開催日・年齢の基準日）は PlainDate で出し入れする。DB では date 型（文字列）・JS の Date にしない（§7.0）

export type Tournament = {
  id: string;
  name: string;
  eventDate: PlainDate | null;
  ageReferenceDate: PlainDate;
  venue: string | null;
  description: string | null;
  entryStartAt: Date | null;
  entryEndAt: Date;
  teamSizeMin: number;
  teamSizeMax: number;
  maxEntries: number | null;
  status: TournamentInputStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const COLUMNS = {
  id: tournaments.id,
  name: tournaments.name,
  eventDate: tournaments.eventDate,
  ageReferenceDate: tournaments.ageReferenceDate,
  venue: tournaments.venue,
  description: tournaments.description,
  entryStartAt: tournaments.entryStartAt,
  entryEndAt: tournaments.entryEndAt,
  teamSizeMin: tournaments.teamSizeMin,
  teamSizeMax: tournaments.teamSizeMax,
  maxEntries: tournaments.maxEntries,
  status: tournaments.status,
  createdAt: tournaments.createdAt,
  updatedAt: tournaments.updatedAt,
  deletedAt: tournaments.deletedAt,
};

type Row = { [K in keyof typeof COLUMNS]: K extends "eventDate" | "ageReferenceDate" ? string | null : Tournament[K] };

// date 型の列（"YYYY-MM-DD"）を PlainDate にする。基準日は NOT NULL なので必ず読める
function toTournament(row: Row): Tournament {
  const reference = parsePlainDate(row.ageReferenceDate ?? "");
  if (!reference) throw new Error("年齢の基準日が読めません");
  return {
    ...row,
    eventDate: row.eventDate ? parsePlainDate(row.eventDate) : null,
    ageReferenceDate: reference,
  };
}

// 入力（日付）を DB の値にする。申し込みの開始はその日の 0:00、締切はその日の 23:59:59（日本時間・§5.4）
function toValues(input: TournamentInput) {
  return {
    name: input.name,
    eventDate: input.eventDate ? formatPlainDate(input.eventDate) : null,
    ageReferenceDate: formatPlainDate(input.ageReferenceDate),
    venue: input.venue,
    description: input.description,
    entryStartAt: input.entryStartDate ? startOfDayTokyo(input.entryStartDate) : null,
    entryEndAt: endOfDayTokyo(input.entryEndDate),
    teamSizeMin: input.teamSizeMin,
    teamSizeMax: input.teamSizeMax,
    maxEntries: input.maxEntries,
    status: input.status,
  };
}

// 管理画面の一覧。締切の新しい順（未定の大会が上に来ないよう締切で並べる）
export async function listTournaments(tx: Tx, associationId: string, options: { includeDeleted?: boolean } = {}): Promise<Tournament[]> {
  const rows = await tx
    .select(COLUMNS)
    .from(tournaments)
    .where(and(eq(tournaments.associationId, associationId), options.includeDeleted ? undefined : isNull(tournaments.deletedAt)))
    .orderBy(desc(tournaments.entryEndAt), asc(tournaments.name))
    .limit(200);
  return rows.map(toTournament);
}

export async function findTournament(tx: Tx, associationId: string, id: string, options: { includeDeleted?: boolean } = {}): Promise<Tournament | null> {
  const [row] = await tx
    .select(COLUMNS)
    .from(tournaments)
    .where(and(eq(tournaments.associationId, associationId), eq(tournaments.id, id), options.includeDeleted ? undefined : isNull(tournaments.deletedAt)))
    .limit(1);
  return row ? toTournament(row) : null;
}

export async function insertTournament(tx: Tx, associationId: string, input: TournamentInput, createdBy: string): Promise<Tournament> {
  const [row] = await tx
    .insert(tournaments)
    .values({ associationId, ...toValues(input), createdBy })
    .returning(COLUMNS);
  return toTournament(row);
}

export async function updateTournament(tx: Tx, associationId: string, id: string, input: TournamentInput): Promise<Tournament | null> {
  const [row] = await tx
    .update(tournaments)
    .set({ ...toValues(input), updatedAt: new Date() })
    .where(and(eq(tournaments.associationId, associationId), eq(tournaments.id, id), isNull(tournaments.deletedAt)))
    .returning(COLUMNS);
  return row ? toTournament(row) : null;
}

// その大会の部門と、部門が指すプリセットの設定値（保存時の整合性の検証に使う・§5.4）
export type CategoryRule = {
  id: string;
  label: string;
  entryEndAt: Date | null;
  courtSize: number;
  mixedMinMale: number;
  mixedMinFemale: number;
};

export async function listCategoryRules(tx: Tx, associationId: string, tournamentId: string): Promise<CategoryRule[]> {
  return tx
    .select({
      id: tournamentCategories.id,
      label: tournamentCategories.label,
      entryEndAt: tournamentCategories.entryEndAt,
      courtSize: categoryPresets.courtSize,
      mixedMinMale: categoryPresets.mixedMinMale,
      mixedMinFemale: categoryPresets.mixedMinFemale,
    })
    .from(tournamentCategories)
    .innerJoin(
      categoryPresets,
      and(eq(categoryPresets.associationId, tournamentCategories.associationId), eq(categoryPresets.id, tournamentCategories.presetId)),
    )
    .where(
      and(
        eq(tournamentCategories.associationId, associationId),
        eq(tournamentCategories.tournamentId, tournamentId),
        isNull(tournamentCategories.deletedAt),
      ),
    )
    .orderBy(asc(tournamentCategories.sortOrder));
}

// 大会ごとの部門の数（一覧の表示用）
export async function countCategoriesByTournament(tx: Tx, associationId: string, tournamentIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>(tournamentIds.map((id) => [id, 0]));
  if (tournamentIds.length === 0) return result;
  const rows = await tx
    .select({ tournamentId: tournamentCategories.tournamentId, value: sql<number>`count(*)::int` })
    .from(tournamentCategories)
    .where(and(eq(tournamentCategories.associationId, associationId), isNull(tournamentCategories.deletedAt)))
    .groupBy(tournamentCategories.tournamentId);
  for (const row of rows) if (result.has(row.tournamentId)) result.set(row.tournamentId, row.value);
  return result;
}

// 公開ページの一覧（§5.6）。準備中（draft）の大会は出さない。締切の近い順に並べる
export async function listPublicTournaments(tx: Tx, associationId: string): Promise<Tournament[]> {
  const rows = await tx
    .select(COLUMNS)
    .from(tournaments)
    .where(and(eq(tournaments.associationId, associationId), isNull(tournaments.deletedAt), ne(tournaments.status, "draft")))
    .orderBy(asc(tournaments.entryEndAt), asc(tournaments.name))
    .limit(200);
  return rows.map(toTournament);
}

// 公開ページの大会詳細。準備中の大会は URL を直に打っても見つからない（§5.6 受け入れ条件）
export async function findPublicTournament(tx: Tx, associationId: string, id: string): Promise<Tournament | null> {
  const [row] = await tx
    .select(COLUMNS)
    .from(tournaments)
    .where(
      and(eq(tournaments.associationId, associationId), eq(tournaments.id, id), isNull(tournaments.deletedAt), ne(tournaments.status, "draft")),
    )
    .limit(1);
  return row ? toTournament(row) : null;
}

// 大会の論理削除（§5.16。物理削除は /admin/trash から）。削除済みなら false
export async function softDeleteTournament(tx: Tx, associationId: string, id: string, deletedBy: string): Promise<boolean> {
  const rows = await tx
    .update(tournaments)
    .set({ deletedAt: new Date(), deletedBy, updatedAt: new Date() })
    .where(and(eq(tournaments.associationId, associationId), eq(tournaments.id, id), isNull(tournaments.deletedAt)))
    .returning({ id: tournaments.id });
  return rows.length > 0;
}
