import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import { startOfDayTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import type { Principal } from "@/lib/authz";
import {
  countCategoriesByTournament,
  findTournament,
  insertTournament,
  listCategoryRules,
  listTournaments,
  softDeleteTournament,
  updateTournament,
  type Tournament,
} from "@/lib/repo/tournaments";
import { clearCategoryDeadlines } from "@/lib/repo/tournament-categories";
import { TeamError } from "@/lib/teams/errors";
import { parseTournamentInput, type TournamentInput } from "@/lib/tournaments/tournament-input";
import { authorizeAssociationAdmin } from "./access";

// 大会の管理（設計書 §5.4・§4.2 #13）。テナント管理者（と切り替えて入った運営管理者）だけ（§3.2 manageTournaments）
// 部の追加・編集は src/lib/admin/categories.ts（B-05）。ここは大会そのものの作成・編集・状態の変更と、設定値の整合性の検証

export type AdminTournamentRow = Tournament & { categories: number };

export async function listTournamentsForAdmin(db: Db, principal: Principal & { userId: string }, associationId: string): Promise<AdminTournamentRow[]> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const rows = await listTournaments(tx, associationId);
      const counts = await countCategoriesByTournament(
        tx,
        associationId,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({ ...r, categories: counts.get(r.id) ?? 0 }));
    },
    { userId: principal.userId },
  );
}

export async function getTournamentForAdmin(db: Db, principal: Principal & { userId: string }, associationId: string, tournamentId: string): Promise<Tournament> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await findTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");
      return tournament;
    },
    { userId: principal.userId },
  );
}

// 表をまたぐ整合性の検証（§5.4「設定値の整合性」）。1 つの表の中で完結するものは tournament-input.ts と DB の CHECK
// ・参加人数の下限 ≧ 部門のコート上の人数
// ・混合の男子の最少人数 ＋ 女子の最少人数 ≦ コート上の人数（プリセットの CHECK でも防いでいるが、部門を足したあとに大会側だけ直されることがある）
// ・部門の締切 ≧ 大会の申し込みの開始
async function assertConsistentWithCategories(tx: Tx, associationId: string, tournamentId: string, input: TournamentInput): Promise<void> {
  const rules = await listCategoryRules(tx, associationId, tournamentId);
  if (rules.length === 0) return;
  const largest = rules.reduce((a, b) => (b.courtSize > a.courtSize ? b : a));
  if (input.teamSizeMin < largest.courtSize) {
    throw new TeamError(409, `参加人数の下限は、コートに出る人数（${largest.label}は${largest.courtSize}人）以上にしてください`, {
      field: "teamSizeMin",
    });
  }
  for (const rule of rules) {
    if (rule.mixedMinMale + rule.mixedMinFemale > rule.courtSize) {
      throw new TeamError(409, `${rule.label}の男女の最少人数が、コートに出る人数を超えています。部の設定を直してください`);
    }
  }
  if (input.entryStartDate) {
    const start = startOfDayTokyo(input.entryStartDate);
    const tooEarly = rules.find((r) => r.entryEndAt && r.entryEndAt < start);
    if (tooEarly) {
      throw new TeamError(409, `${tooEarly.label}の締切が、申し込みの開始日より前になっています。部の締切を直してください`, {
        field: "entryStartDate",
      });
    }
  }
}

export async function createTournament(db: Db, principal: Principal & { userId: string }, associationId: string, raw: Record<string, unknown>): Promise<Tournament> {
  const parsed = parseTournamentInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      return insertTournament(tx, associationId, parsed.value, principal.userId);
    },
    { userId: principal.userId },
  );
}

export async function editTournament(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
  raw: Record<string, unknown>,
): Promise<Tournament> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const parsed = parseTournamentInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const current = await findTournament(tx, associationId, tournamentId);
      if (!current) throw new TeamError(404, "大会が見つかりません");
      // 「部の締切も大会に揃える」を選んだときは、先に部ごとの上書きを外してから大会の締切を見比べる（§5.4 追加仕様 2）
      const sync = raw.syncCategoryDeadlines === true || raw.syncCategoryDeadlines === "true";
      if (sync) await clearCategoryDeadlines(tx, associationId, tournamentId);
      await assertConsistentWithCategories(tx, associationId, tournamentId, parsed.value);
      const updated = await updateTournament(tx, associationId, tournamentId, parsed.value);
      if (!updated) throw new TeamError(404, "大会が見つかりません");
      return updated;
    },
    { userId: principal.userId },
  );
}

// 大会の論理削除（§5.16）。完全に削除するのは /admin/trash から（申込も一緒に消える）
export async function deleteTournament(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
): Promise<void> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const deleted = await softDeleteTournament(tx, associationId, tournamentId, principal.userId);
      if (!deleted) throw new TeamError(404, "大会が見つかりません");
    },
    { userId: principal.userId },
  );
}
