import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { categoryPresets, tournamentCategories } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { PresetGender, PresetRuleType } from "@/lib/presets/default";
import type { PresetInput } from "@/lib/presets/preset-input";

// 部門プリセット（category_presets）のデータアクセス（設計書 §5.4）。テナントごとに構成が違う。削除済みは既定で除く

export type CategoryPreset = {
  id: string;
  code: string;
  labelDefault: string;
  gender: PresetGender;
  ruleType: PresetRuleType;
  ruleValue: number | null;
  courtSize: number;
  mixedMinMale: number;
  mixedMinFemale: number;
  sortOrder: number;
  isActive: boolean;
};

const COLUMNS = {
  id: categoryPresets.id,
  code: categoryPresets.code,
  labelDefault: categoryPresets.labelDefault,
  gender: categoryPresets.gender,
  ruleType: categoryPresets.ruleType,
  ruleValue: categoryPresets.ruleValue,
  courtSize: categoryPresets.courtSize,
  mixedMinMale: categoryPresets.mixedMinMale,
  mixedMinFemale: categoryPresets.mixedMinFemale,
  sortOrder: categoryPresets.sortOrder,
  isActive: categoryPresets.isActive,
};

export async function listCategoryPresets(
  tx: Tx,
  associationId: string,
  options: { onlyActive?: boolean } = {},
): Promise<CategoryPreset[]> {
  return tx
    .select(COLUMNS)
    .from(categoryPresets)
    .where(
      and(
        eq(categoryPresets.associationId, associationId),
        isNull(categoryPresets.deletedAt),
        options.onlyActive ? eq(categoryPresets.isActive, true) : undefined,
      ),
    )
    .orderBy(asc(categoryPresets.sortOrder), asc(categoryPresets.code));
}

export async function findCategoryPreset(tx: Tx, associationId: string, id: string): Promise<CategoryPreset | null> {
  const [row] = await tx
    .select(COLUMNS)
    .from(categoryPresets)
    .where(and(eq(categoryPresets.associationId, associationId), eq(categoryPresets.id, id), isNull(categoryPresets.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function insertCategoryPreset(tx: Tx, associationId: string, input: PresetInput): Promise<CategoryPreset> {
  const [row] = await tx
    .insert(categoryPresets)
    .values({ associationId, ...input })
    .returning(COLUMNS);
  return row;
}

// code は不変の識別子なので更新しない（§5.4）
export async function updateCategoryPreset(tx: Tx, associationId: string, id: string, input: PresetInput): Promise<CategoryPreset | null> {
  const [row] = await tx
    .update(categoryPresets)
    .set({
      labelDefault: input.labelDefault,
      gender: input.gender,
      ruleType: input.ruleType,
      ruleValue: input.ruleValue,
      courtSize: input.courtSize,
      mixedMinMale: input.mixedMinMale,
      mixedMinFemale: input.mixedMinFemale,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    })
    .where(and(eq(categoryPresets.associationId, associationId), eq(categoryPresets.id, id), isNull(categoryPresets.deletedAt)))
    .returning(COLUMNS);
  return row ?? null;
}

export async function softDeleteCategoryPreset(tx: Tx, associationId: string, id: string, deletedBy: string): Promise<boolean> {
  const updated = await tx
    .update(categoryPresets)
    .set({ deletedAt: new Date(), deletedBy })
    .where(and(eq(categoryPresets.associationId, associationId), eq(categoryPresets.id, id), isNull(categoryPresets.deletedAt)))
    .returning({ id: categoryPresets.id });
  return updated.length > 0;
}

// そのプリセットを使っている大会の部の数（削除済みは除く）。使われていれば削除させない
export async function countPresetUsage(tx: Tx, associationId: string, presetIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>(presetIds.map((id) => [id, 0]));
  if (presetIds.length === 0) return result;
  const rows = await tx
    .select({ presetId: tournamentCategories.presetId, value: sql<number>`count(*)::int` })
    .from(tournamentCategories)
    .where(
      and(
        eq(tournamentCategories.associationId, associationId),
        inArray(tournamentCategories.presetId, presetIds),
        isNull(tournamentCategories.deletedAt),
      ),
    )
    .groupBy(tournamentCategories.presetId);
  for (const row of rows) if (result.has(row.presetId)) result.set(row.presetId, row.value);
  return result;
}
