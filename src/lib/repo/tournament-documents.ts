import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { type DocumentType, tournamentDocuments, tournaments } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { type ReadOptions, tenantScope } from "./scope";

// 大会資料のデータアクセス（設計書 §5.9・付録 A）。すべての関数が associationId を受け取り、削除済みは既定で除く
// public_key は「公開用バケットに置いてあるファイルの名前」。公開の状態を揃える処理は src/lib/documents/publish.ts

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

// 公開ページに出す分（公開中で、公開用のファイルが置いてあるもの）。大会が公開されているかは呼ぶ側が見る
export async function listPublicDocuments(tx: Tx, associationId: string, tournamentId: string): Promise<TournamentDocument[]> {
  return tx
    .select(COLUMNS)
    .from(tournamentDocuments)
    .where(
      and(
        tenantScope(tournamentDocuments, associationId),
        eq(tournamentDocuments.tournamentId, tournamentId),
        eq(tournamentDocuments.isPublic, true),
        isNotNull(tournamentDocuments.publicKey),
      ),
    )
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

export type DocumentPatch = Partial<Pick<TournamentDocument, "docType" | "title" | "isPublic" | "sortOrder" | "publicKey" | "sizeBytes">>;

// includeDeleted は公開の状態を揃える処理（削除済みの資料の公開用を取り下げる）だけが使う
export async function updateDocument(
  tx: Tx,
  associationId: string,
  id: string,
  patch: DocumentPatch,
  options: ReadOptions = {},
): Promise<TournamentDocument | null> {
  const [row] = await tx
    .update(tournamentDocuments)
    .set(patch)
    .where(and(tenantScope(tournamentDocuments, associationId, options), eq(tournamentDocuments.id, id)))
    .returning(COLUMNS);
  return row ?? null;
}

export async function softDeleteDocument(tx: Tx, associationId: string, id: string, deletedBy: string): Promise<boolean> {
  const rows = await tx
    .update(tournamentDocuments)
    .set({ deletedAt: new Date(), deletedBy })
    .where(and(eq(tournamentDocuments.associationId, associationId), eq(tournamentDocuments.id, id), isNull(tournamentDocuments.deletedAt)))
    .returning({ id: tournamentDocuments.id });
  return rows.length > 0;
}

export async function deleteDocumentRow(tx: Tx, associationId: string, id: string): Promise<void> {
  await tx.delete(tournamentDocuments).where(and(eq(tournamentDocuments.associationId, associationId), eq(tournamentDocuments.id, id)));
}

// 後始末（日次ジョブ）用。削除済みも含めた ID と、公開用のファイルの名前をすべて返す
export async function listDocumentIds(tx: Tx, associationId: string): Promise<string[]> {
  const rows = await tx.select({ id: tournamentDocuments.id }).from(tournamentDocuments).where(eq(tournamentDocuments.associationId, associationId));
  return rows.map((r) => r.id);
}

export async function listPublicKeys(tx: Tx, associationId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: tournamentDocuments.publicKey })
    .from(tournamentDocuments)
    .where(and(eq(tournamentDocuments.associationId, associationId), isNotNull(tournamentDocuments.publicKey)));
  return rows.flatMap((r) => (r.key ? [r.key] : []));
}

// 協会のトップの「新しい資料」（§5.17）。公開中の大会（準備中・削除済みを除く）の公開中の資料を、新しい順に
export async function listRecentPublicDocuments(
  tx: Tx,
  associationId: string,
  limit: number,
): Promise<(TournamentDocument & { tournamentName: string })[]> {
  return tx
    .select({ ...COLUMNS, tournamentName: tournaments.name })
    .from(tournamentDocuments)
    .innerJoin(
      tournaments,
      and(eq(tournaments.associationId, tournamentDocuments.associationId), eq(tournaments.id, tournamentDocuments.tournamentId)),
    )
    .where(
      and(
        tenantScope(tournamentDocuments, associationId),
        eq(tournamentDocuments.isPublic, true),
        isNotNull(tournamentDocuments.publicKey),
        isNull(tournaments.deletedAt),
        ne(tournaments.status, "draft"),
      ),
    )
    .orderBy(desc(tournamentDocuments.createdAt))
    .limit(limit);
}
