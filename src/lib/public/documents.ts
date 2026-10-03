import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { findDocument, listRecentPublicDocuments } from "@/lib/repo/tournament-documents";
import { findPublicTournament } from "@/lib/repo/tournaments";
import { getStorage, type StorageAdapter } from "@/lib/storage";
import { TeamError } from "@/lib/teams/errors";
import type { DocumentType } from "@/db/schema";

// 協会のトップの「新しい資料」（§5.17 の既定の並び）。公開中の資料だけ。選手の情報は含まない
export type RecentPublicDocument = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  docType: DocumentType;
  title: string;
  sizeBytes: number;
  createdAt: Date;
};

export async function listRecentDocumentsForPublic(db: Db, associationId: string, limit = 5): Promise<RecentPublicDocument[]> {
  return withTenantOn(db, associationId, async (tx) => {
    const rows = await listRecentPublicDocuments(tx, associationId, limit);
    return rows.map((d) => ({
      id: d.id,
      tournamentId: d.tournamentId,
      tournamentName: d.tournamentName,
      docType: d.docType,
      title: d.title,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
    }));
  });
}

// 大会資料の公開用 URL の解決（設計書 §5.9）。利用者が共有するアプリの URL
// `/[スラッグ]/tournaments/[id]/documents/[docId]` から 302 で転送する先
// 資料が非公開・削除済み・公開用に置かれていない、大会が準備中・削除済み、のどれでも 404（理由は分けない）
export async function resolvePublicDocumentUrl(
  db: Db,
  associationId: string,
  tournamentId: string,
  documentId: string,
  storage: StorageAdapter = getStorage(),
): Promise<string> {
  if (!isUuid(tournamentId) || !isUuid(documentId)) throw new TeamError(404, "資料が見つかりません");
  return withTenantOn(db, associationId, async (tx) => {
    const tournament = await findPublicTournament(tx, associationId, tournamentId);
    if (!tournament) throw new TeamError(404, "資料が見つかりません");
    const document = await findDocument(tx, associationId, tournamentId, documentId);
    if (!document || !document.isPublic || !document.publicKey) throw new TeamError(404, "資料が見つかりません");
    return storage.publicUrl(document.publicKey);
  });
}
