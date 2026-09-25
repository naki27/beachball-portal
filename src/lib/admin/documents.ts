import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { checkPdfUpload, PDF_CONTENT_TYPE, parseDocumentInput } from "@/lib/documents/document-input";
import { isUuid } from "@/lib/ids";
import { findDocument, insertDocument, listDocuments, nextSortOrder, type TournamentDocument, updateDocument } from "@/lib/repo/tournament-documents";
import { findTournament, type Tournament } from "@/lib/repo/tournaments";
import { getStorage, type StorageAdapter } from "@/lib/storage";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 大会資料の管理（設計書 §5.9）。テナント管理者（と切り替えて入った運営管理者）だけ（§3.2 manageTournaments）
// アップロードはアプリを経由し、大きさ・Content-Type・先頭の %PDF- を確かめてから保管用（非公開）のバケットに置く
// 公開用へのコピー・非公開にしたときの取り下げ・削除は C-02

export type AdminDocumentsView = { tournament: Tournament; documents: TournamentDocument[] };

type Options = { storage?: StorageAdapter };
type Admin = Principal & { userId: string };

// 保管用バケットのキー。協会 → 大会 → 資料の順に分ける（後始末で大会ごとに消せるように）
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
      return { tournament, documents: await listDocuments(tx, associationId, tournamentId) };
    },
    { userId: principal.userId },
  );
}

export type DocumentUpload = { contentType: string; bytes: Uint8Array };

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
  const check = checkPdfUpload({ size: upload.bytes.byteLength, contentType: upload.contentType, head: upload.bytes.subarray(0, 8) });
  if (!check.ok) throw new TeamError(400, check.message, { field: "file" });
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
      return document;
    },
    { userId: principal.userId },
  );
}

// 種別・タイトル・公開／非公開・並び順の変更。ファイルの差し替えはアップロードし直す（公開用の名前を変えるため・§5.9）
export async function editDocument(
  db: Db,
  principal: Admin,
  associationId: string,
  tournamentId: string,
  documentId: string,
  raw: Record<string, unknown>,
): Promise<TournamentDocument> {
  if (!isUuid(tournamentId) || !isUuid(documentId)) throw new TeamError(404, "資料が見つかりません");
  const parsed = parseDocumentInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });

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
      return updated;
    },
    { userId: principal.userId },
  );
}
