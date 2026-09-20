import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import { ageAt } from "@/lib/age";
import type { Principal } from "@/lib/authz";
import { comparePlainDate, endOfDayTokyo, formatPlainDate, type PlainDate } from "@/lib/date";
import { effectiveAgeReferenceDate, effectiveDeadline } from "@/lib/deadline";
import { isUuid } from "@/lib/ids";
import { applyMixedNotation, isMixedNotation, type MixedNotation } from "@/lib/presets/notation";
import { type CategoryPreset, listCategoryPresets } from "@/lib/repo/category-presets";
import { applyEntryPlayerAges, insertAgeRecalcAudits, listEntryPlayerAges } from "@/lib/repo/entry-ages";
import {
  countEntriesByCategory,
  findTournamentCategory,
  insertTournamentCategories,
  listTournamentCategories,
  softDeleteTournamentCategory,
  type TournamentCategory,
  updateTournamentCategory,
} from "@/lib/repo/tournament-categories";
import { findTournament, type Tournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { parseCategoryInput } from "@/lib/tournaments/category-input";
import { authorizeAssociationAdmin } from "./access";

// 大会の部の管理（設計書 §5.4「部門（カテゴリ）の設計」「部門ごとの締切」「年齢の基準日」・§4.2 #13）
// テナント管理者（と切り替えて入った運営管理者）だけ（§3.2 manageTournaments）
// 有効な締切・有効な基準日の決め方は deadline.ts を通す（ここで now と締切を比べない）

export type AdminCategoryRow = TournamentCategory & {
  entries: number; // 取り消していない申込の数。1 件でもあれば削除できない
  effectiveEntryEndAt: Date;
  effectiveAgeReferenceDate: PlainDate;
};

// 基準日を変えたときの警告（申込ごと。押すまでは申込時点の年齢のまま・§5.4）
export type AgeWarningPlayer = { name: string; before: number | null; after: number };
export type AgeWarning = { entryId: string; teamName: string; categoryLabel: string; players: AgeWarningPlayer[] };

export type AdminCategoriesView = {
  tournament: Tournament;
  categories: AdminCategoryRow[];
  presets: (CategoryPreset & { added: boolean })[];
  ageWarnings: AgeWarning[];
};

async function loadTournament(tx: Tx, associationId: string, tournamentId: string): Promise<Tournament> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const tournament = await findTournament(tx, associationId, tournamentId);
  if (!tournament) throw new TeamError(404, "大会が見つかりません");
  return tournament;
}

async function loadCategories(tx: Tx, associationId: string, tournament: Tournament): Promise<AdminCategoryRow[]> {
  const categories = await listTournamentCategories(tx, associationId, tournament.id);
  const counts = await countEntriesByCategory(
    tx,
    associationId,
    categories.map((c) => c.id),
  );
  return categories.map((c) => ({
    ...c,
    entries: counts.get(c.id) ?? 0,
    effectiveEntryEndAt: effectiveDeadline(c, tournament),
    effectiveAgeReferenceDate: effectiveAgeReferenceDate(c, tournament),
  }));
}

// 保存済みの年齢（申込時点）と、いまの基準日で数えた年齢が食い違う申込を集める
async function loadAgeWarnings(tx: Tx, associationId: string, tournament: Tournament, categories: TournamentCategory[]): Promise<AgeWarning[]> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = await listEntryPlayerAges(tx, associationId, tournament.id);
  const warnings = new Map<string, AgeWarning>();
  for (const row of rows) {
    const category = byId.get(row.categoryId);
    if (!category || !row.birthDate) continue;
    const after = ageAt(row.birthDate, effectiveAgeReferenceDate(category, tournament));
    if (after === row.ageAtEvent) continue;
    const warning = warnings.get(row.entryId) ?? {
      entryId: row.entryId,
      teamName: row.teamName,
      categoryLabel: row.categoryLabel,
      players: [],
    };
    warning.players.push({ name: row.name, before: row.ageAtEvent, after });
    warnings.set(row.entryId, warning);
  }
  return [...warnings.values()];
}

export async function getCategoriesForAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
): Promise<AdminCategoriesView> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await loadTournament(tx, associationId, tournamentId);
      const categories = await loadCategories(tx, associationId, tournament);
      const presets = await listCategoryPresets(tx, associationId, { onlyActive: true });
      const addedCodes = new Set(categories.map((c) => c.code));
      return {
        tournament,
        categories,
        presets: presets.map((p) => ({ ...p, added: addedCodes.has(p.code) })),
        ageWarnings: await loadAgeWarnings(tx, associationId, tournament, categories),
      };
    },
    { userId: principal.userId },
  );
}

// プリセットからチェックで一括追加（§5.4「毎回 18 個手入力させない」）
// すでに同じ code の部がある大会では飛ばす（部分一意の制約で落とさない）
export async function addCategoriesFromPresets(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
  raw: Record<string, unknown>,
): Promise<{ added: number; skipped: number }> {
  const presetIds = Array.isArray(raw.presetIds) ? raw.presetIds.filter((id): id is string => typeof id === "string") : [];
  if (presetIds.length === 0) throw new TeamError(400, "追加する部を選んでください", { field: "presetIds" });
  if (presetIds.some((id) => !isUuid(id))) throw new TeamError(400, "追加する部を選んでください", { field: "presetIds" });
  const notation: MixedNotation = isMixedNotation(raw.mixedNotation) ? raw.mixedNotation : "kanji";

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await loadTournament(tx, associationId, tournamentId);
      const presets = await listCategoryPresets(tx, associationId, { onlyActive: true });
      const byId = new Map(presets.map((p) => [p.id, p]));
      const chosen = presetIds.map((id) => byId.get(id));
      if (chosen.some((p) => !p)) throw new TeamError(404, "選んだ部が見つかりません");

      const existing = await listTournamentCategories(tx, associationId, tournamentId);
      const existingCodes = new Set(existing.map((c) => c.code));
      const toAdd = chosen.filter((p): p is CategoryPreset => !!p && !existingCodes.has(p.code));

      // 参加人数の下限 ≧ コートに出る人数（表をまたぐ整合性・§5.4）
      const tooLarge = toAdd.find((p) => p.courtSize > tournament.teamSizeMin);
      if (tooLarge) {
        throw new TeamError(
          409,
          `${tooLarge.labelDefault}はコートに${tooLarge.courtSize}人出ます。大会の参加人数の下限（${tournament.teamSizeMin}人）を先に増やしてください`,
        );
      }

      const added = await insertTournamentCategories(
        tx,
        associationId,
        tournamentId,
        toAdd.map((p) => ({
          presetId: p.id,
          code: p.code,
          label: applyMixedNotation(p.labelDefault, p.gender, notation),
          sortOrder: p.sortOrder,
        })),
      );
      return { added, skipped: chosen.length - toAdd.length };
    },
    { userId: principal.userId },
  );
}

export async function editCategory(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
  categoryId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  if (!isUuid(categoryId)) throw new TeamError(404, "部が見つかりません");
  const parsed = parseCategoryInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  const input = parsed.value;

  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await loadTournament(tx, associationId, tournamentId);
      const category = await findTournamentCategory(tx, associationId, tournamentId, categoryId);
      if (!category) throw new TeamError(404, "部が見つかりません");
      // 部の締切は大会の申し込みの開始日より後（大会の締切より後にするのは許す・§5.4 追加仕様 2）
      if (input.entryEndDate && tournament.entryStartAt) {
        if (endOfDayTokyo(input.entryEndDate) < tournament.entryStartAt) {
          throw new TeamError(409, "部の締切は、大会の申し込みの開始日と同じ日か、それより後にしてください", { field: "entryEndDate" });
        }
      }
      const ok = await updateTournamentCategory(tx, associationId, categoryId, {
        label: input.label,
        entryEndAt: input.entryEndDate ? endOfDayTokyo(input.entryEndDate) : null,
        ageReferenceDate: input.ageReferenceDate,
        maxEntries: input.maxEntries,
      });
      if (!ok) throw new TeamError(404, "部が見つかりません");
    },
    { userId: principal.userId },
  );
}

// 申込が付いている部は削除できない（§5.4 受け入れ条件）
export async function removeCategory(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
  categoryId: string,
): Promise<void> {
  if (!isUuid(categoryId)) throw new TeamError(404, "部が見つかりません");
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      await loadTournament(tx, associationId, tournamentId);
      const category = await findTournamentCategory(tx, associationId, tournamentId, categoryId);
      if (!category) throw new TeamError(404, "部が見つかりません");
      const counts = await countEntriesByCategory(tx, associationId, [categoryId]);
      const used = counts.get(categoryId) ?? 0;
      if (used > 0) throw new TeamError(409, `この部にはすでに ${used} 件の申し込みがあります。先に申し込みを取り消してください`);
      const ok = await softDeleteTournamentCategory(tx, associationId, categoryId, principal.userId);
      if (!ok) throw new TeamError(404, "部が見つかりません");
    },
    { userId: principal.userId },
  );
}

// 「新しい基準日で確定する」: 申込に保存された年齢を、いまの基準日で数えた年齢に上書きする（§5.4）
export async function confirmAgeReference(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
): Promise<{ entries: number; players: number }> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await loadTournament(tx, associationId, tournamentId);
      const categories = await listTournamentCategories(tx, associationId, tournamentId);
      const byId = new Map(categories.map((c) => [c.id, c]));
      const rows = await listEntryPlayerAges(tx, associationId, tournamentId);

      const updates: { playerId: string; ageAtEvent: number }[] = [];
      const audits = new Map<string, { entryId: string; before: Record<string, unknown>; after: Record<string, unknown> }>();
      for (const row of rows) {
        const category = byId.get(row.categoryId);
        if (!category || !row.birthDate) continue;
        const reference = effectiveAgeReferenceDate(category, tournament);
        const after = ageAt(row.birthDate, reference);
        if (after === row.ageAtEvent) continue;
        updates.push({ playerId: row.playerId, ageAtEvent: after });
        // 履歴には位置と年齢だけを残す（生年月日は入れない・§5.16）
        const audit = audits.get(row.entryId) ?? {
          entryId: row.entryId,
          before: { players: [] as unknown[] },
          after: { ageReferenceDate: formatPlainDate(reference), players: [] as unknown[] },
        };
        (audit.before.players as unknown[]).push({ position: row.position, ageAtEvent: row.ageAtEvent });
        (audit.after.players as unknown[]).push({ position: row.position, ageAtEvent: after });
        audits.set(row.entryId, audit);
      }

      await applyEntryPlayerAges(tx, associationId, updates);
      await insertAgeRecalcAudits(tx, associationId, principal.userId, [...audits.values()]);
      return { entries: audits.size, players: updates.length };
    },
    { userId: principal.userId },
  );
}

// 部ごとに締切が違う大会か（画面に部ごとの締切を出すかの判定・§5.4 追加仕様 2）
export function hasMixedDeadlines(categories: readonly { entryEndAt: Date | null }[]): boolean {
  return categories.some((c) => c.entryEndAt !== null);
}

// 部ごとに基準日が違う大会か（大会の基準日と違う部があるか）
export function hasMixedAgeReferences(categories: readonly { ageReferenceDate: PlainDate | null }[], tournament: { ageReferenceDate: PlainDate }): boolean {
  return categories.some((c) => c.ageReferenceDate !== null && comparePlainDate(c.ageReferenceDate, tournament.ageReferenceDate) !== 0);
}
