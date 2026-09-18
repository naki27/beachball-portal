// 入力の一時保存（設計書 §4.3「通信」）。ブラウザの localStorage に、キー = 協会・画面・大会の ID で置く
// 生年月日を含むため、送信が完了したら、またはログアウトしたら消す。保存から 7 日【仮】経ったものも消す
// ここは純粋関数（Storage を引数で受ける）。React からは src/hooks/use-draft.ts を使う

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_KEY_PREFIX = "draft:";

// Storage のうち使う部分だけ（テストでは Map で代用する）
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

type Envelope<T> = { savedAt: number; value: T };

export type DraftKeyParts = {
  associationId: string;
  screen: string; // 例: entry-form
  // 大会・チームなど、画面の中で対象を区別する ID。なければ省く
  targetId?: string;
};

export function draftKey({ associationId, screen, targetId }: DraftKeyParts): string {
  return `${DRAFT_KEY_PREFIX}${associationId}:${screen}${targetId ? `:${targetId}` : ""}`;
}

function isExpired(savedAt: number, now: number): boolean {
  return now - savedAt > DRAFT_TTL_MS;
}

// 保存した文字列を読む（純粋。Storage に触らない）。壊れていれば・期限切れなら null
export function parseDraft<T>(raw: string, now: number = Date.now()): T | null {
  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(raw) as Envelope<T>;
  } catch {
    return null;
  }
  if (typeof envelope?.savedAt !== "number" || isExpired(envelope.savedAt, now)) return null;
  return envelope.value;
}

// 読む。なければ・壊れていれば・期限切れなら null（壊れたもの・期限切れはそのとき消す）
export function readDraft<T>(storage: DraftStorage, key: string, now: number = Date.now()): T | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const value = parseDraft<T>(raw, now);
  if (value === null) storage.removeItem(key);
  return value;
}

export function writeDraft<T>(storage: DraftStorage, key: string, value: T, now: number = Date.now()): void {
  const envelope: Envelope<T> = { savedAt: now, value };
  try {
    storage.setItem(key, JSON.stringify(envelope));
  } catch {
    // 容量不足・プライベートモードなど。一時保存は補助なので、失敗しても画面の操作は続ける
  }
}

export function removeDraft(storage: DraftStorage, key: string): void {
  storage.removeItem(key);
}

// このサイトの一時保存をすべて消す（ログアウトのとき）。ほかのキーには触らない
export function clearAllDrafts(storage: DraftStorage): number {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

// 期限切れの一時保存を消す（起動時に 1 回）
export function purgeExpiredDrafts(storage: DraftStorage, now: number = Date.now()): number {
  let removed = 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(DRAFT_KEY_PREFIX)) keys.push(key);
  }
  for (const key of keys) {
    const before = storage.getItem(key);
    readDraft(storage, key, now);
    if (before !== null && storage.getItem(key) === null) removed++;
  }
  return removed;
}
