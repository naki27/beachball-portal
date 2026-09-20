import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { checkPdf, type DocumentInput, parseDocumentInput } from "@/lib/documents/document-input";
import { documentStorageKey } from "@/lib/documents/keys";
import { isUuid } from "@/lib/ids";
import {
  findTournamentDocument,
  insertTournamentDocument,
  listTournamentDocuments,
  softDeleteTournamentDocument,
  type TournamentDocument,
  updateTournamentDocument,
} from "@/lib/repo/tournament-documents";
import { findTournament, type Tournament } from "@/lib/repo/tournaments";
import { getStorage } from "@/lib/storage";
import type { StorageAdapter } from "@/lib/storage/types";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 大会資料の管理（設計書 §5.9・C-01）。テナント管理者だけ（§3.2 manageTournaments）
// アップロードはアプリを経由する: 大きさ・Content-Type・先頭の `%PDF-` を検証してから保管用に置く
// 公開用への配置（public_key）は C-02（src/lib/documents/publish.ts）で行う

export type AdminDocumentsView = { tournament: Tournament; documents: TournamentDocument[] };

export type UploadedFile = { name: string; contentType: string; bytes: Uint8Array };

type Actor = Principal & { userId: string };

async function loadTournament(tx: Tx, associationId: string, tournamentId: string): Promise<Tournament> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const tournament = await findTournament(tx, associationId, tournamentId);
  if (!tournament) throw new TeamError(404, "大会が見つかりません");
  return tournament;
}

export async function getDocumentsForAdmin(
  db: Db,
  principal: Actor,
  associationId: string,
  tournamentId: string,
): Promise<AdminDocumentsView> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await loadTournament(tx, associationId, tournamentId);
      return { tournament, documents: await listTournamentDocuments(tx, associationId, tournament.id) };
    },
    { userId: principal.userId },
  );
}

function parsed(raw: Record<string, unknown>): DocumentInput {
  const result = parseDocumentInput(raw);
  if (!result.ok) throw new TeamError(400, result.message, { field: result.field });
  return result.value;
}

function checked(file: UploadedFile): void {
  const check = checkPdf(file);
  if (!check.ok) throw new TeamError(400, check.message, { field: "file" });
}

export type UploadDocumentResult = { documentId: string };

export async function uploadDocument(
  db: Db,
  principal: Actor,
  associationId: string,
  tournamentId: string,
  raw: Record<string, unknown>,
  file: UploadedFile,
  storage: StorageAdapter = getStorage(),
): Promise<UploadDocumentResult> {
  const input = parsed(raw);
  checked(file);
  const documentId = crypto.randomUUID();
  const storageKey = documentStorageKey(associationId, tournamentId, documentId);

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const tournament = await loadTournament(tx, associationId, tournamentId);
      // 先に原本を置く（DB の行だけ増えて中身がない状態を作らない）
      await storage.put("private", storageKey, file.bytes, { contentType: "application/pdf" });
      await insertTournamentDocument(tx, associationId, {
        id: documentId,
        tournamentId: tournament.id,
        docType: input.docType,
        title: input.title,
        storageKey,
        publicKey: null,
        sizeBytes: file.bytes.length,
        isPublic: input.isPublic,
        sortOrder: input.sortOrder,
        uploadedBy: principal.userId,
      });
      return { documentId };
    },
    { userId: principal.userId },
  );
}

export async function editDocument(
  db: Db,
  principal: Actor,
  associationId: string,
  tournamentId: string,
  documentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  if (!isUuid(documentId)) throw new TeamError(404, "資料が見つかりません");
  const input = parsed(raw);

  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      await loadTournament(tx, associationId, tournamentId);
      const document = await findTournamentDocument(tx, associationId, tournamentId, documentId);
      if (!document) throw new TeamError(404, "資料が見つかりません");
      const ok = await updateTournamentDocument(tx, associationId, documentId, { ...input, publicKey: document.publicKey });
      if (!ok) throw new TeamError(404, "資料が見つかりません");
    },
    { userId: principal.userId },
  );
}

// 資料の削除（論理削除）。保管用の原本は残す（物理削除の後始末で消す・§5.19）
export async function removeDocument(
  db: Db,
  principal: Actor,
  associationId: string,
  tournamentId: string,
  documentId: string,
): Promise<void> {
  if (!isUuid(documentId)) throw new TeamError(404, "資料が見つかりません");
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      await loadTournament(tx, associationId, tournamentId);
      const document = await findTournamentDocument(tx, associationId, tournamentId, documentId);
      if (!document) throw new TeamError(404, "資料が見つかりません");
      const ok = await softDeleteTournamentDocument(tx, associationId, documentId, principal.userId);
      if (!ok) throw new TeamError(404, "資料が見つかりません");
    },
    { userId: principal.userId },
  );
}
