import { hashSessionId } from "@/lib/auth/session-hash";
import { formatTimestampTokyo } from "@/lib/date";
import { slugFromUrl } from "@/lib/slug";

// 操作ログの 1 行を組み立てる（docs/adr/0027）。純粋関数だけ（ファイル出力は sink.ts）
// 個人情報は載せない（設計書 §12「ログ」）。氏名・メールアドレス・生年月日は URL に出さない決まりだが、
// 万一入っていても残らないように、値を出さないクエリの名前を決めておく

// 記録しないパス（静的ファイルと死活監視。数が多いだけで調べる役に立たない）
const SKIP_PREFIXES = ["/_next/", "/__nextjs", "/api/health"];

export function shouldSkipPath(path: string): boolean {
  return SKIP_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

// この語を含む名前のクエリは値を伏せる（部分一致。username・teamName・postcode なども拾う）
const SECRET_QUERY_WORDS = ["code", "token", "secret", "password", "mail", "name", "birth", "tel", "phone", "address"];
// 名前がそのまま一致したら伏せる（検索語は氏名のことがある）
const SECRET_QUERY_KEYS = new Set(["q", "query", "keyword", "key", "search"]);

export const REDACTED = "***";

export function isSecretQueryKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_QUERY_KEYS.has(k) || SECRET_QUERY_WORDS.some((word) => k.includes(word));
}

// "?a=1&name=山田" → "a=1&name=***"。クエリがなければ undefined
export function redactQuery(search: string): string | undefined {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return undefined;
  const params = new URLSearchParams(raw);
  const parts: string[] = [];
  for (const [key, value] of params) parts.push(`${key}=${isSecretQueryKey(key) ? REDACTED : value}`);
  return parts.join("&") || undefined;
}

const MAX_PATH = 512;
const MAX_QUERY = 512;
const MAX_USER_AGENT = 256;
const MAX_ACTION = 64;

function cut(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export type RequestFacts = {
  at: Date;
  method: string;
  path: string;
  search: string;
  // セッションの Cookie の値（生）。ハッシュにしてから載せる
  sessionId: string | null;
  // Server Action の id（next-action ヘッダ）。どのページの「どの操作」かの手がかり
  actionId: string | null;
  ip: string | null;
  userAgent: string | null;
};

export type AccessLogRecord = {
  at: string;
  method: string;
  path: string;
  query?: string;
  slug?: string;
  action?: string;
  // DB の sessions.session_hash と同じ値。ここから利用者をたどれる（氏名・メールは載せない）
  session?: string;
  ip?: string;
  ua?: string;
};

export function buildRecord(facts: RequestFacts): AccessLogRecord {
  const record: AccessLogRecord = {
    at: formatTimestampTokyo(facts.at),
    method: facts.method,
    path: cut(facts.path, MAX_PATH),
  };
  const query = redactQuery(facts.search);
  if (query) record.query = cut(query, MAX_QUERY);
  const slug = slugFromUrl(facts.path);
  if (slug) record.slug = slug;
  if (facts.actionId) record.action = cut(facts.actionId, MAX_ACTION);
  if (facts.sessionId) record.session = hashSessionId(facts.sessionId);
  if (facts.ip) record.ip = facts.ip;
  if (facts.userAgent) record.ua = cut(facts.userAgent, MAX_USER_AGENT);
  return record;
}

// JSON Lines（1 行 1 件）。改行まで含めて返す
export function formatLine(record: AccessLogRecord): string {
  return `${JSON.stringify(record)}\n`;
}
