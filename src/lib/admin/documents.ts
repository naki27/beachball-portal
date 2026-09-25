import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { checkPdfUpload, PDF_CONTENT_TYPE, parseDocumentInput } from "@/lib/documents/document-input";
import { shouldBePublic, syncTournamentDocuments } from "@/lib/documents/publish";
import { isUuid } from "@/lib/ids";
import {
  findDocument,
  insertDocument,
  listDocuments,
  nextSortOrder,
  softDeleteDocument,
  type TournamentDocument,
  updateDocument,
} from "@/lib/repo/tournament-documents";
import { findTournament, type Tournament } from "@/lib/repo/tournaments";
import { getStorage, type StorageAdapter } from "@/lib/storage";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 大会資料の管理（設計書 §5.9）。テナント管理者（と切り替えて入った運営管理者）だけ（§3.2 manageTournaments）
// アップロードはアプリを経由し、大きさ・Content-Type・先頭の %PDF- を確かめてから保管用（非公開）のバケットに置く
// 公開用への反映（置く・取り下げる）は、行を変えたあと同じトランザクションで publish.ts の sync に任せる

export type AdminDocument = TournamentDocument & {
  // いま公開用に置かれているか（「公開」でも、大会が準備中の間は置かれない）
  published: boolean;
};
export type AdminDocumentsView = { tournament: Tournament; documents: AdminDocument[] };

type Options = { storage?: StorageAdapter };
type Admin = Principal & { userId: string };

// 保管用バケットのキー。協会 → 大会 → 資料の順に分ける（後始末で大会ごとに消せるように）。差し替えても同じ名前に上書きする
export function documentStorageKey(associationId: string, tournamentId: string, documentId: string): string {
  return `documents/${associationId}/${tournamentId}/${documentId}.pdf`;
}

export async function getDocumentsForAdmin(db: Db, principal: Admin, associationId: string, tournamentId: string): Promise<AdminDocumentsView> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await findTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");
      const documents = await listDocuments(tx, associationId, tournamentId);
      return { tournament, documents: documents.map((d) => ({ ...d, published: shouldBePublic(d, tournament) && d.publicKey !== null })) };
    },
    { userId: principal.userId },
  );
}

export type DocumentUpload = { contentType: string; bytes: Uint8Array };

function checkUpload(upload: DocumentUpload): void {
  const check = checkPdfUpload({ size: upload.bytes.byteLength, contentType: upload.contentType, head: upload.bytes.subarray(0, 8) });
  if (!check.ok) throw new TeamError(400, check.message, { field: "file" });
}

export async function uploadDocument(
  db: Db,
  principal: Admin,
  associationId: string,
  tournamentId: string,
  upload: DocumentUpload,
  raw: Record<string, unknown>,
  options: Options = {},
): Promise<TournamentDocument> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const parsed = parseDocumentInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  checkUpload(upload);
  const storage = options.storage ?? getStorage();

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await findTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");
      const id = randomUUID();
      const storageKey = documentStorageKey(associationId, tournamentId, id);
      const document = await insertDocument(tx, associationId, {
        id,
        tournamentId,
        docType: parsed.value.docType,
        title: parsed.value.title,
        storageKey,
        contentType: PDF_CONTENT_TYPE,
        sizeBytes: upload.bytes.byteLength,
        isPublic: parsed.value.isPublic,
        sortOrder: parsed.value.sortOrder ?? (await nextSortOrder(tx, associationId, tournamentId)),
        uploadedBy: principal.userId,
      });
      // 行を入れてからファイルを置く。置けなければトランザクションごと戻る（行だけが残らない）
      await storage.put("private", storageKey, upload.bytes, { contentType: PDF_CONTENT_TYPE });
      await syncTournamentDocuments(tx, storage, associationId, tournamentId);
      return (await findDocument(tx, associationId, tournamentId, id)) ?? document;
    },
    { userId: principal.userId },
  );
}

// 種別・タイトル・公開／非公開・並び順の変更。公開用の名前（URL）はタイトルを変えても変えない（共有済みのリンクを壊さない）
export async function editDocument(
  db: Db,
  principal: Admin,
  associationId: string,
  tournamentId: string,
  documentId: string,
  raw: Record<string, unknown>,
  options: Options = {},
): Promise<TournamentDocument> {
  if (!isUuid(tournamentId) || !isUuid(documentId)) throw new TeamError(404, "資料が見つかりません");
  const parsed = parseDocumentInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  const storage = options.storage ?? getStorage();

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const current = await findDocument(tx, associationId, tournamentId, documentId);
      if (!current) throw new TeamError(404, "資料が見つかりません");
      const updated = await updateDocument(tx, associationId, documentId, {
        docType: parsed.value.docType,
        title: parsed.value.title,
        isPublic: parsed.value.isPublic,
        sortOrder: parsed.value.sortOrder ?? current.sortOrder,
      });
      if (!updated) throw new TeamError(404, "資料が見つかりません");
      await syncTournamentDocuments(tx, storage, associationId, tournamentId);
      return (await findDocument(tx, associationId, tournamentId, documentId)) ?? updated;
    },
    { userId: principal.userId },
  );
}

// ファイルの差し替え（§5.9）。保管用は同じ名前に上書きし、公開中なら公開用は新しい名前で置き直す（古い URL は開けなくなる）
export async function replaceDocumentFile(
  db: Db,
  principal: Admin,
  associationId: string,
  tournamentId: string,
  documentId: string,
  upload: DocumentUpload,
  options: Options = {},
): Promise<TournamentDocument> {
  if (!isUuid(tournamentId) || !isUuid(documentId)) throw new TeamError(404, "資料が見つかりません");
  checkUpload(upload);
  const storage = options.storage ?? getStorage();

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const current = await findDocument(tx, associationId, tournamentId, documentId);
      if (!current) throw new TeamError(404, "資料が見つかりません");
      await updateDocument(tx, associationId, documentId, { sizeBytes: upload.bytes.byteLength });
      await storage.put("private", current.storageKey, upload.bytes, { contentType: PDF_CONTENT_TYPE });
      await syncTournamentDocuments(tx, storage, associationId, tournamentId, { renew: [documentId] });
      const updated = await findDocument(tx, associationId, tournamentId, documentId);
      if (!updated) throw new TeamError(404, "資料が見つかりません");
      return updated;
    },
    { userId: principal.userId },
  );
}

// 論理削除（§5.16）。公開用からは同時に消える。保管用のファイルは「削除済みデータ」から完全に削除するまで残す
export async function deleteDocument(
  db: Db,
  principal: Admin,
  associationId: string,
  tournamentId: string,
  documentId: string,
  options: Options = {},
): Promise<void> {
  if (!isUuid(tournamentId) || !isUuid(documentId)) throw new TeamError(404, "資料が見つかりません");
  const storage = options.storage ?? getStorage();
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const current = await findDocument(tx, associationId, tournamentId, documentId);
      if (!current) throw new TeamError(404, "資料が見つかりません");
      await softDeleteDocument(tx, associationId, documentId, principal.userId);
      await syncTournamentDocuments(tx, storage, associationId, tournamentId);
    },
    { userId: principal.userId },
  );
}
