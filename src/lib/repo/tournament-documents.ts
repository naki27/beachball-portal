import { and, asc, eq, sql } from "drizzle-orm";
import { type DocumentType, tournamentDocuments } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { type ReadOptions, tenantScope } from "./scope";

// 大会資料のデータアクセス（設計書 §5.9・付録 A）。すべての関数が associationId を受け取り、削除済みは既定で除く

export type TournamentDocument = {
  id: string;
  tournamentId: string;
  docType: DocumentType;
  title: string;
  storageKey: string;
  publicKey: string | null;
  contentType: string;
  sizeBytes: number;
  isPublic: boolean;
  sortOrder: number;
  createdAt: Date;
  deletedAt: Date | null;
};

const COLUMNS = {
  id: tournamentDocuments.id,
  tournamentId: tournamentDocuments.tournamentId,
  docType: tournamentDocuments.docType,
  title: tournamentDocuments.title,
  storageKey: tournamentDocuments.storageKey,
  publicKey: tournamentDocuments.publicKey,
  contentType: tournamentDocuments.contentType,
  sizeBytes: tournamentDocuments.sizeBytes,
  isPublic: tournamentDocuments.isPublic,
  sortOrder: tournamentDocuments.sortOrder,
  createdAt: tournamentDocuments.createdAt,
  deletedAt: tournamentDocuments.deletedAt,
};

// 並び順 → 追加した順
export async function listDocuments(tx: Tx, associationId: string, tournamentId: string, options: ReadOptions = {}): Promise<TournamentDocument[]> {
  return tx
    .select(COLUMNS)
    .from(tournamentDocuments)
    .where(and(tenantScope(tournamentDocuments, associationId, options), eq(tournamentDocuments.tournamentId, tournamentId)))
    .orderBy(asc(tournamentDocuments.sortOrder), asc(tournamentDocuments.createdAt));
}

export async function findDocument(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  id: string,
  options: ReadOptions = {},
): Promise<TournamentDocument | null> {
  const [row] = await tx
    .select(COLUMNS)
    .from(tournamentDocuments)
    .where(
      and(
        tenantScope(tournamentDocuments, associationId, options),
        eq(tournamentDocuments.tournamentId, tournamentId),
        eq(tournamentDocuments.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

// 追加した資料を末尾に置くための番号（いまの最大 + 1。なければ 0）
export async function nextSortOrder(tx: Tx, associationId: string, tournamentId: string): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`(coalesce(max(${tournamentDocuments.sortOrder}), -1) + 1)::int` })
    .from(tournamentDocuments)
    .where(and(tenantScope(tournamentDocuments, associationId), eq(tournamentDocuments.tournamentId, tournamentId)));
  return row?.value ?? 0;
}

export type NewDocument = {
  // ファイルのキーに使うので、呼ぶ側が先に決める
  id: string;
  tournamentId: string;
  docType: DocumentType;
  title: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  isPublic: boolean;
  sortOrder: number;
  uploadedBy: string;
};

export async function insertDocument(tx: Tx, associationId: string, values: NewDocument): Promise<TournamentDocument> {
  const [row] = await tx
    .insert(tournamentDocuments)
    .values({ associationId, ...values })
    .returning(COLUMNS);
  return row;
}

export type DocumentPatch = Partial<Pick<TournamentDocument, "docType" | "title" | "isPublic" | "sortOrder" | "publicKey">>;

export async function updateDocument(tx: Tx, associationId: string, id: string, patch: DocumentPatch): Promise<TournamentDocument | null> {
  const [row] = await tx
    .update(tournamentDocuments)
    .set(patch)
    .where(and(tenantScope(tournamentDocuments, associationId), eq(tournamentDocuments.id, id)))
    .returning(COLUMNS);
  return row ?? null;
}
