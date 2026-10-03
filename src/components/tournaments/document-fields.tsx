// 大会資料の入力欄で共用する見た目と注意書き（設計書 §5.9）。追加のページと一覧の行の編集で同じものを使う

export const DOCUMENT_SELECT_CLASS = "min-h-12 w-full rounded-md border border-border bg-background px-3 text-base";

export const DOCUMENT_FILE_CLASS =
  "min-h-12 w-full rounded-md border border-border bg-background px-3 py-2 text-base file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-2";

export const DOCUMENT_PRIVACY_NOTE =
  "個人情報が含まれていないか確認してください（選手名の載った組み合わせ表などは協会の判断で公開されます）";

type ApiError = { error?: { message?: string; field?: string } };

export async function readDocumentError(response: Response, fallback: string): Promise<{ message: string; field: string | null }> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return { message: body?.error?.message ?? fallback, field: body?.error?.field ?? null };
}
