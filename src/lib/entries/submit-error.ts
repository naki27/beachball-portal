// 送信がサーバーに断られたときの理由を、確認ページから入力ページへ渡す入れ物（設計書 §5.5）
// 「拒否されたら入力ページに戻して理由を該当箇所に出す」。理由には氏名が入りうるので URL には載せない（§12）
// タブを閉じれば消える sessionStorage に置き、入力ページが読んだら消す

export type EntrySubmitError = {
  field?: string;
  playerIndex?: number;
  message: string;
};

export const SUBMIT_ERROR_KEY = "entry-submit-error";

type SessionLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function session(): SessionLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // プライベートモードなどで使えない
  }
}

export function saveSubmitError(key: string, error: EntrySubmitError): void {
  taken.delete(key); // 入力ページに戻ったときに読めるようにする
  try {
    session()?.setItem(`${SUBMIT_ERROR_KEY}:${key}`, JSON.stringify(error));
  } catch {
    // 保存できなくても送信の流れは止めない（確認ページにも同じ理由を出している）
  }
}

// 読んだ結果を覚えておく。React が初期化を 2 回呼んでも同じ値が返る（sessionStorage からは 1 回目で消える）
const taken = new Map<string, EntrySubmitError | null>();

// 1 回だけ読める（読んだら消す）。同じ画面のうちは、何度呼んでも同じ結果
export function takeSubmitError(key: string): EntrySubmitError | null {
  if (taken.has(key)) return taken.get(key) ?? null;
  const store = session();
  if (!store) return null;
  try {
    const raw = store.getItem(`${SUBMIT_ERROR_KEY}:${key}`);
    if (!raw) return null;
    store.removeItem(`${SUBMIT_ERROR_KEY}:${key}`);
    taken.set(key, null); // 壊れていた場合もここで確定する
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as EntrySubmitError;
    const result = typeof value.message === "string" ? value : null;
    taken.set(key, result);
    return result;
  } catch {
    return null;
  }
}
