import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { DOCUMENT_PREFIX } from "@/lib/documents/keys";
import { listAllAssociations } from "@/lib/repo/associations";
import { listLivePublicKeys, listStorageKeys } from "@/lib/repo/tournament-documents";
import type { StorageAdapter } from "@/lib/storage/types";

// 日次ジョブ ⑥「R2 の後始末」（設計書 §6.5.1・§5.9）。大会を完全に削除したあとなど、
// **DB のどの行からも指されていないファイル**（迷子のファイル）を保存先から消す。
//   公開用 … public_key に入っていないもの
//   保管用 … storage_key に入っていないもの（行が丸ごと消えたもの。論理削除済みの行は残すので消さない）
//
// 順番が大事: **先に保存先の一覧を取り、あとで DB を読む**。逆にすると、
// DB を読んだ直後に置かれたファイルを「迷子」と判定して消してしまう

export type DocumentCleanupResult = { publicRemoved: number; privateRemoved: number };

export async function cleanUpDocumentFiles(db: Db, storage: StorageAdapter): Promise<DocumentCleanupResult> {
  const prefix = `${DOCUMENT_PREFIX}/`;
  const publicKeys = await storage.list("public", prefix);
  const privateKeys = await storage.list("private", prefix);

  // 公開用のバケットは協会をまたいで 1 つなので、すべての協会の分を集めてから比べる
  const livePublic = new Set<string>();
  const livePrivate = new Set<string>();
  for (const association of await listAllAssociations(db)) {
    await withTenantOn(db, association.id, async (tx) => {
      for (const key of await listLivePublicKeys(tx, association.id)) livePublic.add(key);
      for (const key of await listStorageKeys(tx, association.id)) livePrivate.add(key);
    });
  }

  const result: DocumentCleanupResult = { publicRemoved: 0, privateRemoved: 0 };
  for (const key of publicKeys) {
    if (livePublic.has(key)) continue;
    await storage.remove("public", key);
    result.publicRemoved += 1;
  }
  for (const key of privateKeys) {
    if (livePrivate.has(key)) continue;
    await storage.remove("private", key);
    result.privateRemoved += 1;
  }
  return result;
}
