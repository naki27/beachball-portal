import type { DocumentType } from "@/db/schema";

// 大会資料の入力の検査（設計書 §5.9）。画面と API で同じ規則を使う
// ファイルそのもの（大きさ・Content-Type・先頭の %PDF-）は checkPdfUpload、種別・タイトルなどは parseDocumentInput

export const DOCUMENT_TYPES: readonly DocumentType[] = ["大会冊子", "要項", "組み合わせ", "結果", "その他"];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 1 ファイル 10 MB まで【仮】（§5.9）
export const MAX_DOCUMENT_BYTES_TEXT = "10 MB";
export const PDF_CONTENT_TYPE = "application/pdf";
export const TITLE_MAX = 100;
// Cloudflare のキャッシュは短め（1 時間【仮】・§5.9）。非公開にしても最長この時間は開けることがある。画面にも出すのでここに置く
export const PUBLIC_CACHE_SECONDS = 3600;
export const PUBLIC_CACHE_TEXT = "1 時間";
const PDF_HEAD = new TextEncoder().encode("%PDF-");

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export type PdfCheck = { ok: true } | { ok: false; message: string };

// 受け取ったファイルが PDF か。拡張子だけ .pdf に変えた画像は先頭の %PDF- で弾く
export function checkPdfUpload(file: { size: number; contentType: string; head: Uint8Array }): PdfCheck {
  if (file.size <= 0) return { ok: false, message: "ファイルを選んでください" };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, message: `ファイルの大きさは ${MAX_DOCUMENT_BYTES_TEXT} までです` };
  const type = file.contentType.split(";")[0].trim().toLowerCase();
  if (type !== PDF_CONTENT_TYPE) return { ok: false, message: "PDF のファイルだけを選べます" };
  if (file.head.length < PDF_HEAD.length || PDF_HEAD.some((byte, i) => file.head[i] !== byte)) {
    return { ok: false, message: "PDF のファイルだけを選べます（中身が PDF ではありません）" };
  }
  return { ok: true };
}

export type DocumentInput = {
  docType: DocumentType;
  title: string;
  isPublic: boolean;
  // 省略したら、追加のときは末尾・編集のときはそのまま
  sortOrder: number | null;
};

export type ParsedDocumentInput = { ok: true; value: DocumentInput } | { ok: false; field: keyof DocumentInput; message: string };

export function parseDocumentInput(raw: Record<string, unknown>): ParsedDocumentInput {
  if (!isDocumentType(raw.docType)) return { ok: false, field: "docType", message: "種別を選んでください" };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { ok: false, field: "title", message: "タイトルを入力してください" };
  if ([...title].length > TITLE_MAX) return { ok: false, field: "title", message: `タイトルは ${TITLE_MAX} 文字までです` };
  const isPublic = toBoolean(raw.isPublic);
  if (isPublic === null) return { ok: false, field: "isPublic", message: "公開するかどうかを選んでください" };
  let sortOrder: number | null = null;
  if (raw.sortOrder !== undefined && raw.sortOrder !== null && raw.sortOrder !== "") {
    const n = typeof raw.sortOrder === "number" ? raw.sortOrder : Number(String(raw.sortOrder).trim());
    if (!Number.isInteger(n) || n < 0 || n > 9999) {
      return { ok: false, field: "sortOrder", message: "並び順は 0〜9999 の整数で入力してください" };
    }
    sortOrder = n;
  }
  return { ok: true, value: { docType: raw.docType, title, isPublic, sortOrder } };
}

// フォーム（文字列）と JSON（真偽値）の両方から読む
function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === "on") return true;
  if (value === "false" || value === "0" || value === "off") return false;
  return null;
}

// 画面に出す大きさ（「1.2 MB」「350 KB」）
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
