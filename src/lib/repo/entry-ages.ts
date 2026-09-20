import { and, asc, eq, isNull } from "drizzle-orm";
import { entries, entryAudits, entryPlayers, tournamentCategories } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { parsePlainDate, type PlainDate } from "@/lib/date";

// 年齢の基準日を変えたときの再計算（設計書 §5.4「年齢の基準日」）
// 申込の entry_players.age_at_event は申込時点の値。基準日を変えても勝手には直さず、管理者が確定したときだけ上書きする

export type EntryPlayerAgeRow = {
  playerId: string;
  entryId: string;
  categoryId: string;
  categoryLabel: string;
  teamName: string;
  position: number;
  name: string;
  birthDate: PlainDate | null; // 物理削除で匿名化された申込は NULL（再計算の対象外）
  ageAtEvent: number | null;
};

// その大会の申込（取り消し・削除済みを除く）の選手を、部の情報と一緒に読む
export async function listEntryPlayerAges(tx: Tx, associationId: string, tournamentId: string): Promise<EntryPlayerAgeRow[]> {
  const rows = await tx
    .select({
      playerId: entryPlayers.id,
      entryId: entryPlayers.entryId,
      categoryId: entries.categoryId,
      categoryLabel: tournamentCategories.label,
      teamName: entries.teamName,
      position: entryPlayers.position,
      name: entryPlayers.name,
      birthDate: entryPlayers.birthDate,
      ageAtEvent: entryPlayers.ageAtEvent,
    })
    .from(entryPlayers)
    .innerJoin(entries, and(eq(entries.associationId, entryPlayers.associationId), eq(entries.id, entryPlayers.entryId)))
    .innerJoin(
      tournamentCategories,
      and(eq(tournamentCategories.associationId, entries.associationId), eq(tournamentCategories.id, entries.categoryId)),
    )
    .where(
      and(
        eq(entryPlayers.associationId, associationId),
        eq(entries.tournamentId, tournamentId),
        eq(entries.status, "submitted"),
        isNull(entries.deletedAt),
      ),
    )
    .orderBy(asc(tournamentCategories.sortOrder), asc(entries.teamName), asc(entryPlayers.position));
  return rows.map((row) => ({ ...row, birthDate: row.birthDate ? parsePlainDate(row.birthDate) : null }));
}

// 新しい基準日での年齢に上書きする（管理者が「新しい基準日で確定する」を押したときだけ）
export async function applyEntryPlayerAges(tx: Tx, associationId: string, updates: readonly { playerId: string; ageAtEvent: number }[]): Promise<void> {
  for (const update of updates) {
    await tx
      .update(entryPlayers)
      .set({ ageAtEvent: update.ageAtEvent })
      .where(and(eq(entryPlayers.associationId, associationId), eq(entryPlayers.id, update.playerId)));
  }
}

// 確定した申込に履歴を残す（生年月日は入れない・§5.16）
export async function insertAgeRecalcAudits(
  tx: Tx,
  associationId: string,
  actorId: string,
  rows: readonly { entryId: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(entryAudits).values(rows.map((row) => ({ associationId, actorId, action: "recalc_age" as const, ...row })));
}
