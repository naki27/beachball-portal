import { cleanText } from "@/lib/teams/team-input";
import { readIntField } from "@/lib/tournaments/tournament-input";

// 大会資料の入力とファイルの検証（設計書 §5.9）。画面とサーバーの両方で使う
// 形式は **PDF だけ**。拡張子・Content-Type・ファイル先頭の `%PDF-` の 3 つを見る（拡張子を変えた画像を通さない）

export const DOC_TYPES = ["大会冊子", "要項", "組み合わせ", "結果", "その他"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TITLE_MAX = 80;
export const DOC_SORT_ORDER_MAX = 9999;
// 1 ファイル 10 MB まで（§5.9【仮】）
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const DOC_CONTENT_TYPE = "application/pdf";

export function isDocType(value: unknown): value is DocType {
  return typeof value === "string" && (DOC_TYPES as readonly string[]).includes(value);
}

export type DocumentInput = { docType: DocType; title: string; isPublic: boolean; sortOrder: number };
export type DocumentField = "docType" | "title" | "isPublic" | "sortOrder" | "file";

export type DocumentInputResult = { ok: true; value: DocumentInput } | { ok: false; field: DocumentField; message: string };

const fail = (field: DocumentField, message: string): DocumentInputResult => ({ ok: false, field, message });

export function parseDocumentInput(raw: Record<string, unknown>): DocumentInputResult {
  if (!isDocType(raw.docType)) return fail("docType", "資料の種別を選んでください");

  const title = cleanText(raw.title);
  if (!title) return fail("title", "資料のタイトルを入力してください");
  if ([...title].length > DOC_TITLE_MAX) return fail("title", `資料のタイトルは${DOC_TITLE_MAX}文字以内で入力してください`);

  const sortOrder = readIntField(raw.sortOrder);
  if (sortOrder === "invalid") return fail("sortOrder", "並び順を数で入力してください");
  if (sortOrder !== null && (sortOrder < 0 || sortOrder > DOC_SORT_ORDER_MAX)) {
    return fail("sortOrder", `並び順は 0 から ${DOC_SORT_ORDER_MAX} の間で入力してください`);
  }

  // チェックボックスは "on" / "true" / true のどれでも来る。文字列の "false" は外れている扱い
  const isPublic = raw.isPublic === true || raw.isPublic === "on" || raw.isPublic === "true";

  return { ok: true, value: { docType: raw.docType, title, isPublic, sortOrder: sortOrder ?? 0 } };
}

export type FileCheckResult = { ok: true } | { ok: false; message: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

// ファイルの中身の検証（§5.9「アップロードはアプリを経由する」）。拒否の理由は利用者に分かる言葉で返す
export function checkPdf(input: { name: string; contentType: string; bytes: Uint8Array }): FileCheckResult {
  if (!/\.pdf$/i.test(input.name)) return { ok: false, message: "PDF のファイル（.pdf）を選んでください" };
  // ブラウザは "application/pdf" か、稀に charset 付きで送ってくる
  if (input.contentType.split(";")[0].trim().toLowerCase() !== DOC_CONTENT_TYPE) {
    return { ok: false, message: "PDF のファイル（.pdf）を選んでください" };
  }
  if (input.bytes.length === 0) return { ok: false, message: "ファイルが空です。もう一度選んでください" };
  if (input.bytes.length > DOC_MAX_BYTES) {
    return { ok: false, message: `ファイルは ${DOC_MAX_BYTES / 1024 / 1024} MB までです。小さくしてから選んでください` };
  }
  if (input.bytes.length < PDF_MAGIC.length || PDF_MAGIC.some((b, i) => input.bytes[i] !== b)) {
    // 拡張子だけ .pdf にした画像などはここで止まる
    return { ok: false, message: "PDF として読めないファイルです。PDF で保存し直してから選んでください" };
  }
  return { ok: true };
}

// 画面に出すファイルの大きさ（「1.2 MB」）
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
