import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { categoryPresets, entries, tournamentCategories } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { formatPlainDate, parsePlainDate, type PlainDate } from "@/lib/date";
import type { PresetGender, PresetRuleType } from "@/lib/presets/default";

// 大会の部（tournament_categories）のデータアクセス（設計書 §5.4）。削除済みは既定で除く
// 判定に使う数値（コートの人数・混合の最少人数・年齢の条件）は、部が指すプリセットから読む（§5.4）

export type TournamentCategory = {
  id: string;
  tournamentId: string;
  presetId: string;
  code: string;
  label: string;
  entryEndAt: Date | null; // NULL なら大会の締切
  ageReferenceDate: PlainDate | null; // NULL なら大会の基準日
  sortOrder: number;
  maxEntries: number | null;
  // プリセット側の設定値
  gender: PresetGender;
  ruleType: PresetRuleType;
  ruleValue: number | null;
  courtSize: number;
  mixedMinMale: number;
  mixedMinFemale: number;
};

const COLUMNS = {
  id: tournamentCategories.id,
  tournamentId: tournamentCategories.tournamentId,
  presetId: tournamentCategories.presetId,
  code: tournamentCategories.code,
  label: tournamentCategories.label,
  entryEndAt: tournamentCategories.entryEndAt,
  ageReferenceDate: tournamentCategories.ageReferenceDate,
  sortOrder: tournamentCategories.sortOrder,
  maxEntries: tournamentCategories.maxEntries,
  gender: categoryPresets.gender,
  ruleType: categoryPresets.ruleType,
  ruleValue: categoryPresets.ruleValue,
  courtSize: categoryPresets.courtSize,
  mixedMinMale: categoryPresets.mixedMinMale,
  mixedMinFemale: categoryPresets.mixedMinFemale,
};

type Row = { [K in keyof typeof COLUMNS]: K extends "ageReferenceDate" ? string | null : TournamentCategory[K] };

function toCategory(row: Row): TournamentCategory {
  return { ...row, ageReferenceDate: row.ageReferenceDate ? parsePlainDate(row.ageReferenceDate) : null };
}

// 部とプリセットの結合（プリセットが論理削除されていても、すでに追加した部は出す）
function joined(tx: Tx) {
  return tx
    .select(COLUMNS)
    .from(tournamentCategories)
    .innerJoin(
      categoryPresets,
      and(eq(categoryPresets.associationId, tournamentCategories.associationId), eq(categoryPresets.id, tournamentCategories.presetId)),
    );
}

export async function listTournamentCategories(tx: Tx, associationId: string, tournamentId: string): Promise<TournamentCategory[]> {
  const rows = await joined(tx)
    .where(
      and(
        eq(tournamentCategories.associationId, associationId),
        eq(tournamentCategories.tournamentId, tournamentId),
        isNull(tournamentCategories.deletedAt),
      ),
    )
    .orderBy(asc(tournamentCategories.sortOrder), asc(tournamentCategories.code));
  return rows.map(toCategory);
}

export async function findTournamentCategory(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  categoryId: string,
): Promise<TournamentCategory | null> {
  const [row] = await joined(tx)
    .where(
      and(
        eq(tournamentCategories.associationId, associationId),
        eq(tournamentCategories.tournamentId, tournamentId),
        eq(tournamentCategories.id, categoryId),
        isNull(tournamentCategories.deletedAt),
      ),
    )
    .limit(1);
  return row ? toCategory(row) : null;
}

export type NewTournamentCategory = { presetId: string; code: string; label: string; sortOrder: number };

export async function insertTournamentCategories(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  rows: readonly NewTournamentCategory[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await tx
    .insert(tournamentCategories)
    .values(rows.map((row) => ({ associationId, tournamentId, ...row })))
    .returning({ id: tournamentCategories.id });
  return inserted.length;
}

export type TournamentCategoryValues = {
  label: string;
  entryEndAt: Date | null;
  ageReferenceDate: PlainDate | null;
  maxEntries: number | null;
};

export async function updateTournamentCategory(
  tx: Tx,
  associationId: string,
  categoryId: string,
  values: TournamentCategoryValues,
): Promise<boolean> {
  const updated = await tx
    .update(tournamentCategories)
    .set({
      label: values.label,
      entryEndAt: values.entryEndAt,
      ageReferenceDate: values.ageReferenceDate ? formatPlainDate(values.ageReferenceDate) : null,
      maxEntries: values.maxEntries,
    })
    .where(
      and(
        eq(tournamentCategories.associationId, associationId),
        eq(tournamentCategories.id, categoryId),
        isNull(tournamentCategories.deletedAt),
      ),
    )
    .returning({ id: tournamentCategories.id });
  return updated.length > 0;
}

export async function softDeleteTournamentCategory(tx: Tx, associationId: string, categoryId: string, deletedBy: string): Promise<boolean> {
  const updated = await tx
    .update(tournamentCategories)
    .set({ deletedAt: new Date(), deletedBy })
    .where(
      and(
        eq(tournamentCategories.associationId, associationId),
        eq(tournamentCategories.id, categoryId),
        isNull(tournamentCategories.deletedAt),
      ),
    )
    .returning({ id: tournamentCategories.id });
  return updated.length > 0;
}

// 「部の締切も大会に揃える」: 部ごとの上書きを外す（NULL = 大会の締切に従う・§5.4 追加仕様 2）
export async function clearCategoryDeadlines(tx: Tx, associationId: string, tournamentId: string): Promise<void> {
  await tx
    .update(tournamentCategories)
    .set({ entryEndAt: null })
    .where(
      and(
        eq(tournamentCategories.associationId, associationId),
        eq(tournamentCategories.tournamentId, tournamentId),
        isNull(tournamentCategories.deletedAt),
      ),
    );
}

// 部ごとの申込の数（取り消し・削除済みを除く）。「申込が付いている部は削除できない」の判定と一覧の表示に使う
export async function countEntriesByCategory(tx: Tx, associationId: string, categoryIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>(categoryIds.map((id) => [id, 0]));
  if (categoryIds.length === 0) return result;
  const rows = await tx
    .select({ categoryId: entries.categoryId, value: sql<number>`count(*)::int` })
    .from(entries)
    .where(
      and(
        eq(entries.associationId, associationId),
        inArray(entries.categoryId, categoryIds),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    )
    .groupBy(entries.categoryId);
  for (const row of rows) if (result.has(row.categoryId)) result.set(row.categoryId, row.value);
  return result;
}
