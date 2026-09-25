import { randomBytes } from "node:crypto";
import type { Tx } from "@/db/tenant";
import { listDocuments, type TournamentDocument, updateDocument } from "@/lib/repo/tournament-documents";
import { findTournament } from "@/lib/repo/tournaments";
import type { StorageAdapter } from "@/lib/storage/types";
import { PDF_CONTENT_TYPE, PUBLIC_CACHE_SECONDS } from "./document-input";

// 大会資料の公開用ファイルの出し入れ（設計書 §5.9「配信の仕組み」・ADR 0026）
// 公開中の資料だけを公開用バケットに置き、非公開にした・削除した・大会を draft に戻したら公開用から消す
// 公開用の名前は推測されにくいランダムな名前。差し替えたら新しい名前にする（古い URL は開けなくなる）
//
// 呼ぶ場所: 資料の追加・編集・差し替え・削除、大会の編集（状態）・削除・復元、削除済みデータの復元、日次ジョブ
// いずれも withTenant のトランザクションの中。ストレージの操作の順番は「消える方向に安全」に揃える:
//   置く … 先に公開用へ置いてから行に名前を入れる（行の更新が戻れば、名前のないファイルが残るだけ → 日次ジョブが消す）
//   消す … 先に行の名前を消してからファイルを消す（消せなければ行ごと戻るので、行とファイルが食い違わない）

export const PUBLIC_DOCUMENT_PREFIX = "documents/";

export function newPublicKey(): string {
  return `${PUBLIC_DOCUMENT_PREFIX}${randomBytes(16).toString("hex")}.pdf`;
}

// ブラウザ内で開き、保存するときはタイトルの名前になる（§5.9）。ヘッダは ASCII だけにするので UTF-8 の値は percent-encoding
export function contentDispositionFor(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
  return `inline; filename*=UTF-8''${encodeURIComponent(`${base}.pdf`)}`;
}

// 公開してよい条件: 資料が「公開」で削除されておらず、大会が準備中（draft）でも削除済みでもない
export function shouldBePublic(
  document: { isPublic: boolean; deletedAt: Date | null },
  tournament: { status: string; deletedAt: Date | null } | null,
): boolean {
  if (!tournament || tournament.deletedAt) return false;
  if (tournament.status === "draft") return false;
  return document.isPublic && document.deletedAt === null;
}

export type SyncResult = {
  published: number;
  withdrawn: number;
  // 保管用のファイルが見つからず公開できなかった数（行はそのまま。ログに件数だけ出す）
  missing: number;
};

// 1 つの大会の資料を、あるべき状態に揃える。renew に入れた資料は、公開中でも新しい名前で置き直す（差し替え）
export async function syncTournamentDocuments(
  tx: Tx,
  storage: StorageAdapter,
  associationId: string,
  tournamentId: string,
  options: { renew?: readonly string[] } = {},
): Promise<SyncResult> {
  const result: SyncResult = { published: 0, withdrawn: 0, missing: 0 };
  const documents = await listDocuments(tx, associationId, tournamentId, { includeDeleted: true });
  if (documents.length === 0) return result;
  const tournament = await findTournament(tx, associationId, tournamentId, { includeDeleted: true });
  const renew = new Set(options.renew ?? []);

  for (const document of documents) {
    if (shouldBePublic(document, tournament)) {
      if (document.publicKey && !renew.has(document.id)) continue;
      const body = await storage.get("private", document.storageKey);
      if (!body) {
        result.missing += 1;
        continue;
      }
      const key = newPublicKey();
      await storage.put("public", key, body, {
        contentType: PDF_CONTENT_TYPE,
        contentDisposition: contentDispositionFor(document.title),
        cacheControl: `public, max-age=${PUBLIC_CACHE_SECONDS}`,
      });
      await updateDocument(tx, associationId, document.id, { publicKey: key }, { includeDeleted: true });
      // 差し替え: 新しい名前を置いてから古い名前を消す（消せなくても、古いほうは日次ジョブが消す）
      if (document.publicKey) await storage.remove("public", document.publicKey);
      result.published += 1;
    } else if (document.publicKey) {
      await updateDocument(tx, associationId, document.id, { publicKey: null }, { includeDeleted: true });
      await storage.remove("public", document.publicKey);
      result.withdrawn += 1;
    }
  }
  return result;
}

// 資料のファイルを保管用・公開用の両方から消す（物理削除の直前・§5.16）。行は呼ぶ側が消す
export async function removeDocumentFiles(tx: Tx, storage: StorageAdapter, associationId: string, document: TournamentDocument): Promise<void> {
  if (document.publicKey) {
    await updateDocument(tx, associationId, document.id, { publicKey: null }, { includeDeleted: true });
    await storage.remove("public", document.publicKey);
  }
  await storage.remove("private", document.storageKey);
}
