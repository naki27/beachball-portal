import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { listEntriesForMember, listEntriesForTeams, type MyEntryRow } from "@/lib/repo/entries";
import { findMemberByUserId } from "@/lib/repo/members";
import { listTeamsAdminedBy } from "@/lib/repo/teams";

// マイページの申込（設計書 §5.3）と、協会のトップの「あなたのやること」（§5.17）の材料
//   代表者として操作できる申込 … 代表者を務めるチーム（個人登録も含む）の申込
//   選手として出る申込         … 自分の人物が選手として入っている申込（招待で紐づいた場合・§5.15）
// どちらも自分に関わる申込なので、氏名・チーム名までは出す（生年月日は出さない・§3.2）

export type MyEntry = {
  entryId: string;
  tournamentId: string;
  tournamentName: string;
  categoryLabel: string;
  teamId: string;
  teamName: string;
  status: "submitted" | "cancelled";
  deadline: Date;
  // 締切前の代表者は変更・取消ができる（画面の出し分け。実際の判定はサーバー側・§5.5(d)）
  canManage: boolean;
};

export type MyEntries = { managed: MyEntry[]; asPlayer: MyEntry[] };

function toEntry(row: MyEntryRow, canManage: boolean): MyEntry {
  return {
    entryId: row.entryId,
    tournamentId: row.tournamentId,
    tournamentName: row.tournamentName,
    categoryLabel: row.categoryLabel,
    teamId: row.teamId,
    teamName: row.teamName,
    status: row.status,
    deadline: new Date(row.entryEndAt),
    canManage,
  };
}

export async function listMyEntries(db: Db, principal: Principal, associationId: string): Promise<MyEntries> {
  if (!principal.userId) return { managed: [], asPlayer: [] };
  const userId = principal.userId;
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const teams = (await listTeamsAdminedBy(tx, associationId, userId)).filter((team) => !team.deletedAt);
      const managed = (await listEntriesForTeams(tx, associationId, teams.map((team) => team.id))).map((row) => toEntry(row, true));

      const me = await findMemberByUserId(tx, associationId, userId);
      const managedIds = new Set(managed.map((entry) => entry.entryId));
      const asPlayer = me
        ? (await listEntriesForMember(tx, associationId, me.id)).filter((row) => !managedIds.has(row.entryId)).map((row) => toEntry(row, false))
        : [];

      return { managed, asPlayer };
    },
    { userId },
  );
}

// 「あなたのやること」に出す申込（§5.17「表示」）
//   受付中でまだ申し込んでいない … 「◯◯大会の受付中です（まだ申し込んでいません）」
//   申し込み済み                 … 「◯◯大会に申し込み済みです」
export type EntryTodo = { key: string; text: string; href: string };

export function entryTodos(
  slug: string,
  openTournaments: { id: string; name: string }[],
  entries: MyEntry[],
  hasTeam: boolean,
): EntryTodo[] {
  if (!hasTeam) return [];
  const submitted = entries.filter((entry) => entry.status === "submitted");
  return openTournaments.map((tournament) => {
    const mine = submitted.find((entry) => entry.tournamentId === tournament.id);
    return mine
      ? { key: `entry-${tournament.id}`, text: `${tournament.name}に申し込み済みです`, href: `/${slug}/entries/${mine.entryId}` }
      : {
          key: `entry-${tournament.id}`,
          text: `${tournament.name}の受付中です（まだ申し込んでいません）`,
          href: `/${slug}/tournaments/${tournament.id}/entry`,
        };
  });
}
