import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { PUBLIC_DOCUMENT_PREFIX, syncTournamentDocuments } from "@/lib/documents/publish";
import { listAllAssociations } from "@/lib/repo/associations";
import { listDocumentIds, listPublicKeys } from "@/lib/repo/tournament-documents";
import { listTournamentIds } from "@/lib/repo/tournaments";
import type { StorageAdapter } from "@/lib/storage/types";

// 日次ジョブ ⑥ 大会資料の後始末（設計書 §5.9・§6.5.1）。app_job で動かす
// 1. 公開の整合: 公開すべきなのに公開用にない・公開すべきでないのに公開用にある資料を直す（途中で失敗した操作の取り残し）
// 2. 保管用の消し忘れ: 行が物理削除された（大会ごと消えたときを含む）のに残っているファイルを消す
// 3. 公開用の消し忘れ: どの行からも指されていないファイルを消す（置いたあとに行の更新が戻った分など）
// 夜間に動く前提。置いている最中の資料と重なると消してしまうことがあるが、次に公開の整合が直す

export type DocumentCleanupResult = {
  published: number;
  withdrawn: number;
  missing: number;
  removedPrivate: number;
  removedPublic: number;
};

const PRIVATE_PREFIX = "documents/";

export async function cleanupDocuments(db: Db, storage: StorageAdapter): Promise<DocumentCleanupResult> {
  const result: DocumentCleanupResult = { published: 0, withdrawn: 0, missing: 0, removedPrivate: 0, removedPublic: 0 };
  const referencedPublicKeys = new Set<string>();

  for (const association of await listAllAssociations(db)) {
    await withTenantOn(db, association.id, async (tx) => {
      for (const tournamentId of await listTournamentIds(tx, association.id)) {
        const synced = await syncTournamentDocuments(tx, storage, association.id, tournamentId);
        result.published += synced.published;
        result.withdrawn += synced.withdrawn;
        result.missing += synced.missing;
      }
      const ids = new Set(await listDocumentIds(tx, association.id));
      for (const key of await storage.list("private", `${PRIVATE_PREFIX}${association.id}/`)) {
        const id = key.split("/").pop()?.replace(/\.pdf$/, "") ?? "";
        if (ids.has(id)) continue;
        await storage.remove("private", key);
        result.removedPrivate += 1;
      }
      for (const key of await listPublicKeys(tx, association.id)) referencedPublicKeys.add(key);
    });
  }

  for (const key of await storage.list("public", PUBLIC_DOCUMENT_PREFIX)) {
    if (referencedPublicKeys.has(key)) continue;
    await storage.remove("public", key);
    result.removedPublic += 1;
  }
  return result;
}
