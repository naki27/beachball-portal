// 協会のスラッグ（URL の先頭・設計書 §5.14「URL とテナント」）。純粋関数だけ（DB には触らない。クライアントでも使える）

// 英小文字・数字・ハイフンで 3〜30 文字
export const SLUG_PATTERN = /^[a-z0-9-]{3,30}$/;

// 予約語（協会のスラッグには使えない。URL の解決順 ①）。設計書の一覧に、Next.js とファイルの規約で先頭に来る名前を足している
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "login",
  "logout",
  "mypage",
  "platform",
  "invitations",
  "account",
  "auth",
  "me",
  "webhooks",
  "health",
  "privacy",
  "terms",
  "contact",
  "site-contact",
  "_next",
  "static",
  "dev",
  "robots.txt",
  "favicon.ico",
  "sitemap.xml",
  "manifest.json",
]);

export type SlugClass = "reserved" | "invalid" | "candidate";

// reserved: 協会の画面ではない ／ invalid: 形が違う（404） ／ candidate: DB で現行・旧スラッグを探す
export function classifySlug(slug: string): SlugClass {
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  if (!SLUG_PATTERN.test(slug)) return "invalid";
  return "candidate";
}

// 旧スラッグの URL を新しいスラッグに置き換える（解決順 ③ の 308）。パスの残りと検索文字列は保つ
// 画面 /old/x?y と API /api/old/x?y の両方。返すのはパス＋検索文字列
export function redirectTargetFor(url: string, currentSlug: string): string {
  const parsed = new URL(url, "http://localhost");
  const segments = parsed.pathname.split("/"); // ["", "old", ...] または ["", "api", "old", ...]
  const index = segments[1] === "api" ? 2 : 1;
  segments[index] = currentSlug;
  return segments.join("/") + parsed.search;
}

// URL の先頭の区切りから協会のスラッグの候補を取り出す（エラーページの「協会のトップへ戻る」用）。なければ null
export function slugFromUrl(url: string): string | null {
  const parsed = new URL(url, "http://localhost");
  const segments = parsed.pathname.split("/");
  const first = segments[1] === "api" ? segments[2] : segments[1];
  return first && classifySlug(first) === "candidate" ? first : null;
}
