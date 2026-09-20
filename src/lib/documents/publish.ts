import type { Tx } from "@/db/tenant";
import type { TournamentStatus } from "@/db/schema";
import {
  clearPublicKeys,
  listTournamentDocuments,
  type TournamentDocument,
  updateTournamentDocument,
} from "@/lib/repo/tournament-documents";
import type { StorageAdapter } from "@/lib/storage/types";
import { contentDisposition, newDocumentPublicKey } from "./keys";

// 公開用バケットへの出し入れ（設計書 §5.9「配信の仕組み」）。**判定と同期はここだけ**
//   公開用に置く条件 = 資料が公開中（is_public）× 大会が draft でない × どちらも削除されていない
//   非公開にした・削除した・大会を draft に戻した → 公開用から消す（public_key を NULL に戻す）
//   ファイルを差し替えた → **新しい名前**で置き、古いファイルは消す（古い URL は開けなくなる）
// Cloudflare のキャッシュは短め（1 時間【仮】）。非公開にしてから最長その時間は開けることを管理画面に書く

export const PUBLIC_CACHE_SECONDS = 3600;

export function shouldBePublic(document: { isPublic: boolean }, tournament: { status: TournamentStatus; deletedAt?: Date | null }): boolean {
  return document.isPublic && tournament.status !== "draft" && !tournament.deletedAt;
}

function publicPutOptions(title: string) {
  return {
    contentType: "application/pdf",
    contentDisposition: contentDisposition(title),
    cacheControl: `public, max-age=${PUBLIC_CACHE_SECONDS}`,
  };
}

export type PublishResult = { publicKey: string | null; changed: boolean };

// 1 件の資料を、いまあるべき状態に合わせる。DB の public_key も更新する
// 置くとき: 先に公開用へ PUT → DB を更新（DB に名前だけ入って中身がない状態を作らない）
// 下ろすとき: 先に DB を更新 → 公開用から削除（消えたのに DB からは開けると言い続ける状態を作らない）
export async function syncDocumentPublication(
  tx: Tx,
  storage: StorageAdapter,
  associationId: string,
  tournament: { status: TournamentStatus; deletedAt?: Date | null },
  document: TournamentDocument,
): Promise<PublishResult> {
  const target = shouldBePublic(document, tournament);
  if (target === (document.publicKey !== null)) return { publicKey: document.publicKey, changed: false };

  if (target) {
    const body = await storage.get("private", document.storageKey);
    // 原本がないときは公開しない（次の同期でまた試す）
    if (!body) return { publicKey: null, changed: false };
    const publicKey = newDocumentPublicKey();
    await storage.put("public", publicKey, body, publicPutOptions(document.title));
    await updateTournamentDocument(tx, associationId, document.id, {
      docType: document.docType,
      title: document.title,
      isPublic: document.isPublic,
      sortOrder: document.sortOrder,
      publicKey,
    });
    return { publicKey, changed: true };
  }

  const old = document.publicKey;
  await updateTournamentDocument(tx, associationId, document.id, {
    docType: document.docType,
    title: document.title,
    isPublic: document.isPublic,
    sortOrder: document.sortOrder,
    publicKey: null,
  });
  if (old) await storage.remove("public", old);
  return { publicKey: null, changed: true };
}

// ファイルの差し替え。公開中なら新しい名前で置き直す（古い URL は開けなくなる・§5.9）
export async function republishWithNewFile(
  tx: Tx,
  storage: StorageAdapter,
  associationId: string,
  tournament: { status: TournamentStatus; deletedAt?: Date | null },
  document: TournamentDocument,
): Promise<PublishResult> {
  const old = document.publicKey;
  if (!shouldBePublic(document, tournament)) {
    if (old) {
      await updateTournamentDocument(tx, associationId, document.id, {
        docType: document.docType,
        title: document.title,
        isPublic: document.isPublic,
        sortOrder: document.sortOrder,
        publicKey: null,
      });
      await storage.remove("public", old);
    }
    return { publicKey: null, changed: old !== null };
  }
  const result = await syncDocumentPublication(tx, storage, associationId, tournament, { ...document, publicKey: null });
  if (old && old !== result.publicKey) await storage.remove("public", old);
  return { publicKey: result.publicKey, changed: true };
}

// 大会を draft に戻した・大会を削除した → その大会の資料をまとめて公開用から下ろす
export async function unpublishTournament(
  tx: Tx,
  storage: StorageAdapter,
  associationId: string,
  tournamentId: string,
): Promise<number> {
  const keys = await clearPublicKeys(tx, associationId, tournamentId);
  for (const key of keys) await storage.remove("public", key);
  return keys.length;
}

// 大会の状態が変わったとき（draft ⇄ open など）に、その大会の資料をまとめてあるべき状態に合わせる
export async function syncTournamentDocuments(
  tx: Tx,
  storage: StorageAdapter,
  associationId: string,
  tournament: { id: string; status: TournamentStatus; deletedAt?: Date | null },
): Promise<number> {
  let changed = 0;
  for (const document of await listTournamentDocuments(tx, associationId, tournament.id)) {
    const result = await syncDocumentPublication(tx, storage, associationId, tournament, document);
    if (result.changed) changed += 1;
  }
  return changed;
}
