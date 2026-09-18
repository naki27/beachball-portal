// 表示名（任意・設計書 §5.3）。招待のメールや運営の画面で「招待した人」「協会の管理者」の名前として出る
// 前後の空白を除き、空なら「表示名なし」（null）。長さの上限は docs/adr/0007

export const DISPLAY_NAME_MAX = 30;

export type DisplayNameResult = { ok: true; value: string | null } | { ok: false; message: string };

export function parseDisplayName(input: unknown): DisplayNameResult {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, message: "表示名を入力してください" };
  const value = input.normalize("NFC").replace(/[\s　]+/g, " ").trim();
  if (value === "") return { ok: true, value: null };
  // 改行・タブなどの制御文字は上の置き換えで空白になる。残る制御文字（\u0000 など）は受け付けない
  if (/\p{Cc}/u.test(value)) return { ok: false, message: "使えない文字が含まれています" };
  if ([...value].length > DISPLAY_NAME_MAX) return { ok: false, message: `${DISPLAY_NAME_MAX}文字以内で入力してください` };
  return { ok: true, value };
}
