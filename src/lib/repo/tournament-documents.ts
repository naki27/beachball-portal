import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { tournamentDocuments } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { DocType } from "@/lib/documents/document-input";

// 大会資料（tournament_documents）のデータアクセス（設計書 §5.9）。削除済みは既定で除く
// association_id はすべてのクエリに入れる（RLS だけに頼らない）

export type TournamentDocument = {
  id: string;
  tournamentId: string;
  docType: DocType;
  title: string;
  storageKey: string;
  publicKey: string | null;
  sizeBytes: number;
  isPublic: boolean;
  sortOrder: number;
  createdAt: Date;
};

const COLUMNS = {
  id: tournamentDocuments.id,
  tournamentId: tournamentDocuments.tournamentId,
  docType: tournamentDocuments.docType,
  title: tournamentDocuments.title,
  storageKey: tournamentDocuments.storageKey,
  publicKey: tournamentDocuments.publicKey,
  sizeBytes: tournamentDocuments.sizeBytes,
  isPublic: tournamentDocuments.isPublic,
  sortOrder: tournamentDocuments.sortOrder,
  createdAt: tournamentDocuments.createdAt,
};

export async function listTournamentDocuments(tx: Tx, associationId: string, tournamentId: string): Promise<TournamentDocument[]> {
  return tx
    .select(COLUMNS)
    .from(tournamentDocuments)
    .where(
      and(
        eq(tournamentDocuments.associationId, associationId),
        eq(tournamentDocuments.tournamentId, tournamentId),
        isNull(tournamentDocuments.deletedAt),
      ),
    )
    .orderBy(asc(tournamentDocuments.sortOrder), asc(tournamentDocuments.createdAt));
}

export async function findTournamentDocument(
  tx: Tx,
  associationId: string,
  tournamentId: string,
  documentId: string,
): Promise<TournamentDocument | null> {
  const [row] = await tx
    .select(COLUMNS)
    .from(tournamentDocuments)
    .where(
      and(
        eq(tournamentDocuments.associationId, associationId),
        eq(tournamentDocuments.tournamentId, tournamentId),
        eq(tournamentDocuments.id, documentId),
        isNull(tournamentDocuments.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type NewTournamentDocument = {
  id: string;
  tournamentId: string;
  docType: DocType;
  title: string;
  storageKey: string;
  publicKey: string | null;
  sizeBytes: number;
  isPublic: boolean;
  sortOrder: number;
  uploadedBy: string;
};

export async function insertTournamentDocument(tx: Tx, associationId: string, row: NewTournamentDocument): Promise<void> {
  await tx.insert(tournamentDocuments).values({ associationId, contentType: "application/pdf", ...row });
}

export type TournamentDocumentValues = {
  docType: DocType;
  title: string;
  isPublic: boolean;
  sortOrder: number;
  publicKey: string | null;
};

export async function updateTournamentDocument(
  tx: Tx,
  associationId: string,
  documentId: string,
  values: TournamentDocumentValues,
): Promise<boolean> {
  const updated = await tx
    .update(tournamentDocuments)
    .set(values)
    .where(
      and(
        eq(tournamentDocuments.associationId, associationId),
        eq(tournamentDocuments.id, documentId),
        isNull(tournamentDocuments.deletedAt),
      ),
    )
    .returning({ id: tournamentDocuments.id });
  return updated.length > 0;
}

// ファイルを差し替えたときの大きさの更新（差し替えは同じ保管用のキーに上書きする・§5.9）
export async function updateTournamentDocumentSize(tx: Tx, associationId: string, documentId: string, sizeBytes: number): Promise<void> {
  await tx
    .update(tournamentDocuments)
    .set({ sizeBytes })
    .where(
      and(
        eq(tournamentDocuments.associationId, associationId),
        eq(tournamentDocuments.id, documentId),
        isNull(tournamentDocuments.deletedAt),
      ),
    );
}

export async function softDeleteTournamentDocument(tx: Tx, associationId: string, documentId: string, deletedBy: string): Promise<boolean> {
  const updated = await tx
    .update(tournamentDocuments)
    .set({ deletedAt: new Date(), deletedBy, publicKey: null })
    .where(
      and(
        eq(tournamentDocuments.associationId, associationId),
        eq(tournamentDocuments.id, documentId),
        isNull(tournamentDocuments.deletedAt),
      ),
    )
    .returning({ id: tournamentDocuments.id });
  return updated.length > 0;
}

// 大会を draft に戻したときなど、まとめて公開用から下ろす（§5.9）。**下ろす前の**公開用のキーを返す
// UPDATE の RETURNING は更新後の値（NULL）を返すので、先に読んでから消す
export async function clearPublicKeys(tx: Tx, associationId: string, tournamentId: string): Promise<string[]> {
  const where = and(
    eq(tournamentDocuments.associationId, associationId),
    eq(tournamentDocuments.tournamentId, tournamentId),
    isNotNull(tournamentDocuments.publicKey),
  );
  const rows = await tx.select({ publicKey: tournamentDocuments.publicKey }).from(tournamentDocuments).where(where);
  if (rows.length === 0) return [];
  await tx.update(tournamentDocuments).set({ publicKey: null }).where(where);
  return rows.map((row) => row.publicKey).filter((key): key is string => !!key);
}

// いま公開用に置いてあるべきキー（日次ジョブの後始末で「迷子のファイル」を見つけるのに使う・§6.5.1 ⑥）
export async function listLivePublicKeys(tx: Tx, associationId: string): Promise<string[]> {
  const rows = await tx
    .select({ publicKey: tournamentDocuments.publicKey })
    .from(tournamentDocuments)
    .where(and(eq(tournamentDocuments.associationId, associationId), isNotNull(tournamentDocuments.publicKey)));
  return rows.map((row) => row.publicKey).filter((key): key is string => !!key);
}

// 保管用のキー（物理削除の後始末に使う。**論理削除済みも含める**。消すのは行ごと消えたものだけ）
export async function listStorageKeys(tx: Tx, associationId: string): Promise<string[]> {
  const rows = await tx
    .select({ storageKey: tournamentDocuments.storageKey })
    .from(tournamentDocuments)
    .where(eq(tournamentDocuments.associationId, associationId));
  return rows.map((row) => row.storageKey);
}

// 資料の数（大会の一覧・公開ページに出す）
export async function countPublicDocuments(tx: Tx, associationId: string, tournamentId: string): Promise<number> {
  const [row] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(tournamentDocuments)
    .where(
      and(
        eq(tournamentDocuments.associationId, associationId),
        eq(tournamentDocuments.tournamentId, tournamentId),
        eq(tournamentDocuments.isPublic, true),
        isNotNull(tournamentDocuments.publicKey),
        isNull(tournamentDocuments.deletedAt),
      ),
    );
  return row?.value ?? 0;
}
