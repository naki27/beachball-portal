import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { getMembership } from "@/lib/auth/principal";
import { type Principal, resolveRole } from "@/lib/authz";
import { fiscalYear, todayInTokyo } from "@/lib/date";
import { entryState } from "@/lib/deadline";
import { isUuid } from "@/lib/ids";
import { findAssociationById } from "@/lib/repo/associations";
import { findEntry, listEntryPlayers } from "@/lib/repo/entries";
import { hasMembershipsForYear } from "@/lib/repo/memberships";
import { isActiveTeamAdmin } from "@/lib/repo/teams";
import { findTournamentCategory, listTournamentCategories } from "@/lib/repo/tournament-categories";
import { findTournament, type Tournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { type EntryFormCategory, type EntryFormPlayer, loadEntryFormRoster, toEntryFormCategory } from "./entry-form";
import type { PlayerSlot } from "./player-slots";

// 申込の変更ページが要る材料（設計書 §5.5(d)）。申込フォームを作り直さず、同じ部品に今の内容を入れて出す
// 締切後は代表者には 409（画面も読み取り専用にするが、API でも止める・update-entry.ts）。管理者は開ける

export type EntryEditData = {
  entryId: string;
  tournament: Tournament;
  teamId: string;
  teamName: string;
  categoryId: string;
  note: string;
  categories: EntryFormCategory[];
  roster: EntryFormPlayer[];
  // 申込時点のスナップショットから作った選手枠（§5.5「申込はスナップショット」）
  slots: PlayerSlot[];
  // 選手一覧にいなくなった人（脱退・削除）。枠に「選手一覧にいません」と印を出す
  missingMemberIds: string[];
  teamSizeMin: number;
  teamSizeMax: number;
  year: number;
  showMembersOnly: boolean;
  isAssociationAdmin: boolean;
};

export async function getEntryEditData(
  db: Db,
  principal: Principal,
  associationId: string,
  entryId: string,
  now: Date = new Date(),
): Promise<EntryEditData> {
  if (!principal.userId) throw new TeamError(403, "ログインが必要です");
  if (!isUuid(entryId)) throw new TeamError(404, "申し込みが見つかりません");
  const userId = principal.userId;
  const membership = await getMembership(principal, associationId);
  const isAssociationAdmin = resolveRole(principal, membership, { associationId }) === "association_admin";
  const fiscalYearStartMonth = (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const entry = await findEntry(tx, associationId, entryId);
      if (!entry) throw new TeamError(404, "申し込みが見つかりません");
      if (!(await isActiveTeamAdmin(tx, associationId, entry.teamId, userId)) && !isAssociationAdmin) {
        throw new TeamError(403, "チームの代表者だけができます");
      }
      const tournament = await findTournament(tx, associationId, entry.tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");
      const current = await findTournamentCategory(tx, associationId, entry.tournamentId, entry.categoryId);
      if (!current) throw new TeamError(404, "部が見つかりません");

      if (entry.status === "cancelled") throw new TeamError(409, "この申し込みは取り消されています");
      // 締切後は代表者には変えられない。問い合わせの導線は呼ぶ側の画面が出す（§5.5(d)）
      if (!isAssociationAdmin && entryState(tournament, current, now) !== "open") {
        throw new TeamError(409, "この部の申し込みは締め切りました");
      }

      const categoryRows = await listTournamentCategories(tx, associationId, entry.tournamentId);
      const categories = categoryRows.map((category) => toEntryFormCategory(category, tournament, isAssociationAdmin, now));

      const year = fiscalYear(tournament.eventDate ?? todayInTokyo(now), fiscalYearStartMonth);
      const roster = await loadEntryFormRoster(tx, associationId, entry.teamId, year);
      const onRoster = new Set(roster.map((player) => player.memberId));

      const players = await listEntryPlayers(tx, associationId, entry.id);
      const missingMemberIds = players
        .filter((player) => !player.memberId || !onRoster.has(player.memberId))
        .map((player) => player.memberId)
        .filter((id): id is string => id !== null);

      // 申込の内容をそのまま枠に入れる。選手一覧にいない人も残したまま出し、外すかどうかは代表者が決める（§5.5）
      const slots: PlayerSlot[] = players.map((player) => ({
        kind: player.memberId ? "pick" : "manual",
        memberId: player.memberId,
        name: player.name,
        kana: player.kana,
        birthDate: player.birthDate,
        sex: player.sex,
      }));

      return {
        entryId: entry.id,
        tournament,
        teamId: entry.teamId,
        teamName: entry.teamName,
        categoryId: entry.categoryId,
        note: entry.note ?? "",
        categories,
        roster,
        slots,
        missingMemberIds,
        teamSizeMin: tournament.teamSizeMin,
        teamSizeMax: tournament.teamSizeMax,
        year,
        showMembersOnly: await hasMembershipsForYear(tx, associationId, year),
        isAssociationAdmin,
      };
    },
    { userId },
  );
}
