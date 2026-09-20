import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { parsePresetInput } from "@/lib/presets/preset-input";
import {
  type CategoryPreset,
  countPresetUsage,
  findCategoryPreset,
  insertCategoryPreset,
  listCategoryPresets,
  softDeleteCategoryPreset,
  updateCategoryPreset,
} from "@/lib/repo/category-presets";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 部門プリセットの管理（設計書 §5.4「プリセットはテナント設定画面から管理者が編集できる」）
// 協会ごとに部の構成が違うので、ここで編集した内容が大会に部を足すときの候補になる（§3.2 manageTournaments）

export type AdminPresetRow = CategoryPreset & { usedBy: number };

export async function listPresetsForAdmin(db: Db, principal: Principal & { userId: string }, associationId: string): Promise<AdminPresetRow[]> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const presets = await listCategoryPresets(tx, associationId);
      const usage = await countPresetUsage(
        tx,
        associationId,
        presets.map((p) => p.id),
      );
      return presets.map((p) => ({ ...p, usedBy: usage.get(p.id) ?? 0 }));
    },
    { userId: principal.userId },
  );
}

export async function createPreset(db: Db, principal: Principal & { userId: string }, associationId: string, raw: Record<string, unknown>): Promise<CategoryPreset> {
  const parsed = parsePresetInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const existing = await listCategoryPresets(tx, associationId);
      if (existing.some((p) => p.code === parsed.value.code)) {
        throw new TeamError(409, "同じ記号の部がすでにあります。別の記号にしてください", { field: "code" });
      }
      return insertCategoryPreset(tx, associationId, parsed.value);
    },
    { userId: principal.userId },
  );
}

// code は不変（前回コピー・年度比較の突合に使う・§5.4）。画面でも変えられないようにしている
export async function editPreset(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  presetId: string,
  raw: Record<string, unknown>,
): Promise<CategoryPreset> {
  if (!isUuid(presetId)) throw new TeamError(404, "「よく使う部」が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const current = await findCategoryPreset(tx, associationId, presetId);
      if (!current) throw new TeamError(404, "「よく使う部」が見つかりません");
      const parsed = parsePresetInput({ ...raw, code: current.code });
      if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
      const updated = await updateCategoryPreset(tx, associationId, presetId, parsed.value);
      if (!updated) throw new TeamError(404, "「よく使う部」が見つかりません");
      return updated;
    },
    { userId: principal.userId },
  );
}

// 使われているプリセットは消さない（過去の大会の部が指しているため・§5.4）。当面使わないだけなら「候補に出さない」にする
export async function removePreset(db: Db, principal: Principal & { userId: string }, associationId: string, presetId: string): Promise<void> {
  if (!isUuid(presetId)) throw new TeamError(404, "「よく使う部」が見つかりません");
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const current = await findCategoryPreset(tx, associationId, presetId);
      if (!current) throw new TeamError(404, "「よく使う部」が見つかりません");
      const usage = await countPresetUsage(tx, associationId, [presetId]);
      const used = usage.get(presetId) ?? 0;
      if (used > 0) {
        throw new TeamError(409, `この「よく使う部」は ${used} つの大会で使われています。削除せずに「新しい大会の候補に出さない」にしてください`);
      }
      const ok = await softDeleteCategoryPreset(tx, associationId, presetId, principal.userId);
      if (!ok) throw new TeamError(404, "「よく使う部」が見つかりません");
    },
    { userId: principal.userId },
  );
}
