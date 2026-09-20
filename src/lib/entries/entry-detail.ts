import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import { getMembership } from "@/lib/auth/principal";
import { can, type Principal, resolveRole } from "@/lib/authz";
import { effectiveDeadline } from "@/lib/deadline";
import { isUuid } from "@/lib/ids";
import { findEntry, listEntryPlayers } from "@/lib/repo/entries";
import { findMemberByUserId } from "@/lib/repo/members";
import { findActiveTeamMember } from "@/lib/repo/team-members";
import { isActiveTeamAdmin } from "@/lib/repo/teams";
import { findTournamentCategory } from "@/lib/repo/tournament-categories";
import { findTournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";

// 申込の参照（設計書 §5.7 の完了画面・§10 の GET /api/entries/:id）。変更・取消は B-12
// 見せる範囲は §3.2: 代表者以上には生年月日・年齢・性別、選手には本人の分だけ

export type EntryDetailPlayer = {
  position: number;
  name: string;
  kana: string | null;
  // 代表者以上と本人にだけ入る
  personal: { age: number | null; sex: "male" | "female" } | null;
};

export type EntryDetail = {
  entryId: string;
  status: "submitted" | "cancelled";
  tournamentId: string;
  tournamentName: string;
  categoryLabel: string;
  teamId: string;
  teamName: string;
  note: string | null;
  players: EntryDetailPlayer[];
  deadline: Date;
  submittedAt: Date;
  needsAdminCheck: boolean;
  // 代表者として開いているか（B-12 の変更・取消の導線）
  canManage: boolean;
};

// その申込を見てよい人か（§3.2）。代表者・その申込のチームの選手・テナント管理者
async function readEntryDetail(
  tx: Tx,
  principal: Principal & { userId: string },
  associationId: string,
  entryId: string,
): Promise<EntryDetail> {
  if (!isUuid(entryId)) throw new TeamError(404, "申し込みが見つかりません");
  const entry = await findEntry(tx, associationId, entryId);
  if (!entry) throw new TeamError(404, "申し込みが見つかりません");

  const membership = await getMembership(principal, associationId);
  const role = resolveRole(principal, membership, { associationId, teamId: entry.teamId });
  const isTeamAdmin = await isActiveTeamAdmin(tx, associationId, entry.teamId, principal.userId);
  const canManage = isTeamAdmin || can(role, "viewOtherTeams");
  if (!canManage && !can(role, "viewOwnTeamEntries")) throw new TeamError(403, "この申し込みは見られません");

  const [tournament, players] = await Promise.all([
    findTournament(tx, associationId, entry.tournamentId),
    listEntryPlayers(tx, associationId, entryId),
  ]);
  if (!tournament) throw new TeamError(404, "大会が見つかりません");
  const category = await findTournamentCategory(tx, associationId, entry.tournamentId, entry.categoryId);

  // 選手として見ている人には、自分以外の年齢・性別を返さない（§3.2）
  const self = canManage ? null : await findSelfMemberId(tx, associationId, entry.teamId, principal.userId);

  return {
    entryId: entry.id,
    status: entry.status,
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    categoryLabel: category?.label ?? "",
    teamId: entry.teamId,
    teamName: entry.teamName,
    note: entry.note,
    players: players.map((player) => ({
      position: player.position,
      name: player.name,
      kana: player.kana,
      personal:
        canManage || (self !== null && player.memberId === self)
          ? { age: player.ageAtEvent, sex: player.sex }
          : null,
    })),
    deadline: category ? effectiveDeadline(category, tournament) : tournament.entryEndAt,
    submittedAt: entry.submittedAt,
    needsAdminCheck: entry.needsAdminCheck,
    canManage,
  };
}

// 見ている人自身の人物（そのチームの選手として入っているか）
async function findSelfMemberId(tx: Tx, associationId: string, teamId: string, userId: string): Promise<string | null> {
  const member = await findMemberByUserId(tx, associationId, userId);
  if (!member) return null;
  return (await findActiveTeamMember(tx, associationId, teamId, member.id)) ? member.id : null;
}

export function getEntryDetail(
  db: Db,
  principal: Principal,
  associationId: string,
  entryId: string,
): Promise<EntryDetail> {
  if (!principal.userId) throw new TeamError(403, "ログインが必要です");
  const userId = principal.userId;
  return withTenantOn(db, associationId, (tx) => readEntryDetail(tx, { ...principal, userId }, associationId, entryId), { userId });
}
