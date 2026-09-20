import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import { formatDateTimeTokyo, fiscalYear, todayInTokyo } from "@/lib/date";
import { toCsv } from "@/lib/export/csv";
import { isUuid } from "@/lib/ids";
import type { Principal } from "@/lib/authz";
import { findAssociationById } from "@/lib/repo/associations";
import {
  type AdminEntryRow,
  clearNeedsAdminCheck,
  findEntry,
  insertEntryAudit,
  listEntriesForAdmin,
  listEntryPlayersForTournament,
  softDeleteEntry,
} from "@/lib/repo/entries";
import { insertExportLog } from "@/lib/repo/export-logs";
import { listMembers } from "@/lib/membership";
import { hasMembershipsForYear } from "@/lib/repo/memberships";
import { findTournament, type Tournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { SEX_LABEL } from "@/lib/teams/player-input";
import { authorizeAssociationAdmin } from "./access";

// 管理画面の申込一覧と CSV（設計書 §5.5(f)・§4.2 #14）。テナント管理者だけ
// 取消済み・削除済みの申込は出さない。CSV は 1 選手 1 行で、申込の情報を各行に繰り返す
// **生年月日は既定で含めず、チェックを入れたときだけ含める**（§5.13）。出力は export_logs に記録する

export type AdminEntryPlayerView = {
  position: number;
  name: string;
  kana: string | null;
  age: number | null;
  sex: "male" | "female";
  birthDate: string | null;
  membership: string; // 協会員区分（その年度のデータがなければ空欄）
};

export type AdminEntryView = AdminEntryRow & { players: AdminEntryPlayerView[] };

export type AdminEntriesView = {
  tournament: Tournament;
  entries: AdminEntryView[];
  // 部ごとの申込数（定員の判断に使う）
  countsByCategory: { categoryId: string; label: string; count: number }[];
  year: number;
  hasMembershipData: boolean;
};

// 協会員区分（§5.12）。細かい表示（「更新の受付中」など）は 1d の D-05 で足す
function membershipText(hasData: boolean, approved: boolean): string {
  if (!hasData) return "";
  return approved ? "協会員" : "非会員";
}

async function readEntries(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  year: number,
): Promise<{ tournament: Tournament; rows: AdminEntryView[]; hasMembershipData: boolean }> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const tournament = await findTournament(tx, associationId, tournamentId);
  if (!tournament) throw new TeamError(404, "大会が見つかりません");

  const [entryRows, playerRows] = await Promise.all([
    listEntriesForAdmin(tx, associationId, tournamentId),
    listEntryPlayersForTournament(tx, associationId, tournamentId),
  ]);
  const memberIds = playerRows.map((player) => player.memberId).filter((id): id is string => id !== null);
  const hasMembershipData = await hasMembershipsForYear(tx, associationId, year);
  const approved = hasMembershipData ? await listMembers(tx, associationId, year, memberIds) : new Set<string>();

  const byEntry = new Map<string, AdminEntryPlayerView[]>();
  for (const player of playerRows) {
    const list = byEntry.get(player.entryId) ?? [];
    list.push({
      position: player.position,
      name: player.name,
      kana: player.kana,
      age: player.ageAtEvent,
      sex: player.sex,
      birthDate: player.birthDate,
      membership: membershipText(hasMembershipData, !!player.memberId && approved.has(player.memberId)),
    });
    byEntry.set(player.entryId, list);
  }

  return {
    tournament,
    rows: entryRows.map((entry) => ({ ...entry, players: byEntry.get(entry.entryId) ?? [] })),
    hasMembershipData,
  };
}

export async function getAdminEntries(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
  now: Date = new Date(),
): Promise<AdminEntriesView> {
  const startMonth = (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
      const tournament = await findTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");
      const year = fiscalYear(tournament.eventDate ?? todayInTokyo(now), startMonth);
      const { rows, hasMembershipData } = await readEntries(tx, associationId, tournamentId, year);

      const counts = new Map<string, { categoryId: string; label: string; count: number }>();
      for (const entry of rows) {
        const found = counts.get(entry.categoryId) ?? { categoryId: entry.categoryId, label: entry.categoryLabel, count: 0 };
        found.count += 1;
        counts.set(entry.categoryId, found);
      }

      return { tournament, entries: rows, countsByCategory: [...counts.values()], year, hasMembershipData };
    },
    { userId: principal.userId },
  );
}

// 「確認済み」（運営の確認対象の印を外す・§5.5）
export async function markEntryChecked(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  entryId: string,
  now: Date = new Date(),
): Promise<void> {
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      if (!isUuid(entryId)) throw new TeamError(404, "申し込みが見つかりません");
      const entry = await findEntry(tx, associationId, entryId);
      if (!entry) throw new TeamError(404, "申し込みが見つかりません");
      await clearNeedsAdminCheck(tx, associationId, entryId, principal.userId, now);
      await insertEntryAudit(tx, associationId, {
        entryId,
        actorId: principal.userId,
        action: "admin_checked",
        before: { needsAdminCheck: entry.needsAdminCheck },
        after: { needsAdminCheck: false },
      });
    },
    { userId: principal.userId },
  );
}

export type EntriesCsv = { filename: string; body: string; rowCount: number };

// CSV の中身（見出し＋ 1 選手 1 行）。管理画面からの出力と、日次のバックアップ（B-14）で同じものを使う
export async function buildEntriesCsv(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  year: number,
  options: { includeBirthDate: boolean },
): Promise<{ body: string; rowCount: number }> {
  const { rows } = await readEntries(tx, associationId, tournamentId, year);
  const header = options.includeBirthDate ? [...BASE_COLUMNS, "生年月日"] : [...BASE_COLUMNS];
  const lines: (string | number | null)[][] = [header];
  for (const entry of rows) {
    for (const player of entry.players) {
      const line: (string | number | null)[] = [
        entry.entryId,
        entry.categoryLabel,
        entry.teamName,
        player.position,
        player.name,
        player.kana,
        SEX_LABEL[player.sex],
        player.age,
        player.membership,
        entry.needsAdminCheck ? "要確認" : "",
        entry.note,
        formatDateTimeTokyo(entry.submittedAt),
        formatDateTimeTokyo(entry.updatedAt),
      ];
      if (options.includeBirthDate) line.push(player.birthDate);
      lines.push(line);
    }
  }
  return { body: toCsv(lines), rowCount: lines.length - 1 };
}

const BASE_COLUMNS = [
  "申込番号",
  "部",
  "チーム名",
  "選手の順番",
  "氏名",
  "ふりがな",
  "性別",
  "年齢",
  "協会員区分",
  "運営の確認対象",
  "備考",
  "申込日時",
  "最終更新日時",
] as const;

// 申込一覧の CSV（§5.5(f)）。1 選手 1 行。生年月日はチェックを入れたときだけ最後の列に足す
export async function exportEntriesCsv(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  tournamentId: string,
  options: { includeBirthDate: boolean },
  now: Date = new Date(),
): Promise<EntriesCsv> {
  const startMonth = (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
      const tournament = await findTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");
      const year = fiscalYear(tournament.eventDate ?? todayInTokyo(now), startMonth);
      const { body, rowCount } = await buildEntriesCsv(tx, associationId, tournamentId, year, options);

      await insertExportLog(tx, associationId, {
        userId: principal.userId,
        scope: "tournament",
        scopeId: tournamentId,
        format: "csv",
        year,
        includesBirthDate: options.includeBirthDate,
        rowCount,
      });

      return {
        // 氏名は入れない。大会 ID と日付だけ（§12）
        filename: `entries-${tournamentId}-${formatFileDate(now)}.csv`,
        body,
        rowCount,
      };
    },
    { userId: principal.userId },
  );
}

function formatFileDate(now: Date): string {
  const today = todayInTokyo(now);
  return `${today.year}${String(today.month).padStart(2, "0")}${String(today.day).padStart(2, "0")}`;
}

// 申込の論理削除（§5.16。誤登録の取り消し。取消（status = cancelled）とは別物で、一覧・CSV から消える）
// 完全に削除するのは /admin/trash から
export async function deleteEntryByAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  entryId: string,
  now: Date = new Date(),
): Promise<void> {
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      if (!isUuid(entryId)) throw new TeamError(404, "申し込みが見つかりません");
      const deleted = await softDeleteEntry(tx, associationId, entryId, principal.userId, now);
      if (!deleted) throw new TeamError(404, "申し込みが見つかりません");
    },
    { userId: principal.userId },
  );
}
