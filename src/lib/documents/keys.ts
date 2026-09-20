import { randomBytes } from "node:crypto";

// 大会資料の置き場所の名前（設計書 §5.9「バケットを 2 つに分ける」）
//   保管用（private）… 大会ごとに整理した名前。原本。ここだけは公開しない
//   公開用（public） … **推測されにくいランダムな名前**。差し替えたら新しい名前にする（古い URL は消える）

export const DOCUMENT_PREFIX = "documents";

export function documentStorageKey(associationId: string, tournamentId: string, documentId: string): string {
  return `${DOCUMENT_PREFIX}/${associationId}/${tournamentId}/${documentId}.pdf`;
}

// 公開用のキー。大会や協会の ID を含めない（URL から中身を推測されないため）
export function newDocumentPublicKey(): string {
  return `${DOCUMENT_PREFIX}/${randomBytes(16).toString("hex")}.pdf`;
}

// 公開用のファイルに付ける Content-Disposition（ブラウザ内で開き、保存時は分かりやすい名前にする・§5.9）
export function contentDisposition(title: string): string {
  const name = `${title.replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
  return `inline; filename*=UTF-8''${encodeURIComponent(name)}`;
}
