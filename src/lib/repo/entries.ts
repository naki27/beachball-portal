import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { entries } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 申込（entries）のリポジトリ。申込の作成・変更は B-09 以降。ここには読み取りと、ほかのタスクが要る判定の口を置く

// 締切前で取り消していない申込の数（§5.11「チームの無効化と削除」: 残っていれば代表者は無効化・削除できない）
// B-09 で申込を作れるようにしたら、締切（deadline.ts）と状態で数える形に置き換える。それまでは常に 0
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function countOpenEntries(tx: Tx, associationId: string, teamId: string, now: Date): Promise<number> {
  return 0;
}

// 参加チーム一覧（§5.6）。**部とチーム名だけ**。選手の情報はこの関数の戻り値に入れない
export type PublicEntryTeam = { categoryId: string; teamName: string };

export async function listPublicEntryTeams(tx: Tx, associationId: string, tournamentId: string): Promise<PublicEntryTeam[]> {
  return tx
    .select({ categoryId: entries.categoryId, teamName: entries.teamName })
    .from(entries)
    .where(
      and(
        eq(entries.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(asc(entries.teamName), asc(entries.submittedAt))
    .limit(1000);
}

// 大会ごとの申込の数（一覧の「◯チーム」）。取り消し・削除済みは数えない
export async function countEntriesByTournament(tx: Tx, associationId: string, tournamentIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>(tournamentIds.map((id) => [id, 0]));
  if (tournamentIds.length === 0) return result;
  const rows = await tx
    .select({ tournamentId: entries.tournamentId, value: sql<number>`count(*)::int` })
    .from(entries)
    .where(and(eq(entries.associationId, associationId), eq(entries.status, "submitted"), isNull(entries.deletedAt)))
    .groupBy(entries.tournamentId);
  for (const row of rows) if (result.has(row.tournamentId)) result.set(row.tournamentId, row.value);
  return result;
}
