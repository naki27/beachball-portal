import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { buildEntriesCsv } from "@/lib/admin/entries";
import { diffDays, formatPlainDate, todayInTokyo } from "@/lib/date";
import { fiscalYearForTournament } from "@/lib/membership";
import { tournamentEntryState } from "@/lib/deadline";
import { findAssociationById, listAllAssociations } from "@/lib/repo/associations";
import { listTournamentCategories } from "@/lib/repo/tournament-categories";
import { listTournaments } from "@/lib/repo/tournaments";
import { backupPublicKey } from "@/lib/storage/backup-key";
import { encryptForBackup } from "@/lib/storage/encrypt";
import type { StorageAdapter } from "@/lib/storage/types";

// 日次ジョブ ②「締切後の申込一覧 CSV のバックアップ」（設計書 §5.5(f)・§6.5.1）
// すべての部の締切を過ぎた大会について、**開催日の翌日まで毎日** CSV を作り、暗号化してバックアップ用に保存する。
// アプリや DB が止まっても、大会の運営に必要な一覧を取り出せるようにするため。
// 列は既定のまま（**生年月日は含めない**）。同じ日に 2 回流しても同じ名前で上書きになる

export const BACKUP_PREFIX = "entries";

export function entryBackupKey(associationId: string, tournamentId: string, day: { year: number; month: number; day: number }): string {
  return `${BACKUP_PREFIX}/${associationId}/${tournamentId}/${formatPlainDate(day)}.csv.enc`;
}

export type EntryBackupResult = { tournaments: number; rows: number; skipped: number };

export async function backupClosedTournamentEntries(
  db: Db,
  storage: StorageAdapter,
  now: Date = new Date(),
): Promise<EntryBackupResult> {
  const today = todayInTokyo(now);
  const publicKey = backupPublicKey();
  const result: EntryBackupResult = { tournaments: 0, rows: 0, skipped: 0 };

  for (const association of await listAllAssociations(db)) {
    // 年度の開始月は協会ごとに違う（associations はテナントに属さないので withTenant の外で読む）
    const startMonth = (await findAssociationById(db, association.id))?.fiscalYearStartMonth ?? 4;
    let skipped = 0;
    const jobs = await withTenantOn(db, association.id, async (tx) => {
      const found: { tournamentId: string; body: string; rowCount: number }[] = [];
      for (const tournament of await listTournaments(tx, association.id)) {
        if (tournament.status === "draft") continue;
        const categories = await listTournamentCategories(tx, association.id, tournament.id);
        if (tournamentEntryState(tournament, categories, now) !== "closed") continue;
        // 開催日の翌日まで。開催日が未定の大会は締切を過ぎたあともしばらく作り続ける（日数は同じ規則で数える）
        if (tournament.eventDate && diffDays(tournament.eventDate, today) > 1) continue;
        // 協会員区分は大会の開催日の年度で判定する（§5.12「表示」）
        const year = fiscalYearForTournament(tournament.eventDate, startMonth, now);
        // 1 つの大会で失敗しても、ほかの大会のバックアップは作る（消された直後などはここで飛ばす）
        try {
          const csv = await buildEntriesCsv(tx, association.id, tournament.id, year, { includeBirthDate: false, now });
          if (csv.rowCount === 0) continue; // 申込のない大会は作らない
          found.push({ tournamentId: tournament.id, body: csv.body, rowCount: csv.rowCount });
        } catch {
          skipped += 1;
        }
      }
      return found;
    });

    result.skipped += skipped;
    for (const job of jobs) {
      await storage.put("backup", entryBackupKey(association.id, job.tournamentId, today), encryptForBackup(publicKey, job.body), {
        contentType: "application/octet-stream",
      });
      result.tournaments += 1;
      result.rows += job.rowCount;
    }
  }

  return result;
}
