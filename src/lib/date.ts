// src/lib/date.ts — 業務上の日付（締切・年度・年齢の基準日・生年月日）は日本時間の「年月日」で扱う（設計書 §7.0・付録 D）
// JavaScript の Date に変換すると UTC で 1 日ずれるため、年月日の組（PlainDate）で持つ。「今日」は todayInTokyo() だけから取る
// DB の date 型（drizzle の date({ mode: "string" })）とフォームの value とは "YYYY-MM-DD" の文字列でやりとりする
// サーバーの TZ 環境変数には頼らない（テストは TZ=UTC と TZ=Asia/Tokyo の両方で流す）

export type PlainDate = { year: number; month: number; day: number }; // month は 1〜12

const TOKYO_OFFSET_HOURS = 9;

const tokyoDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// ある瞬間の、日本時間での年月日。引数なしなら「今日」
export function todayInTokyo(now: Date = new Date()): PlainDate {
  const [year, month, day] = tokyoDateFormat.format(now).split("-").map(Number);
  return { year, month, day };
}

// 日付で入力された締切 → その日の 23:59:59.999（日本時間）の瞬間（§5.4）
export function endOfDayTokyo(d: PlainDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, 23 - TOKYO_OFFSET_HOURS, 59, 59, 999));
}

// 日付で入力された申込開始 → その日の 0:00（日本時間）の瞬間
export function startOfDayTokyo(d: PlainDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, -TOKYO_OFFSET_HOURS, 0, 0, 0));
}

// 暦の上で存在する日付か（2026-02-30 や 13 月を弾く）
export function isValidPlainDate(d: PlainDate): boolean {
  if (!Number.isInteger(d.year) || !Number.isInteger(d.month) || !Number.isInteger(d.day)) return false;
  const utc = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return utc.getUTCFullYear() === d.year && utc.getUTCMonth() === d.month - 1 && utc.getUTCDate() === d.day;
}

// "YYYY-MM-DD" にする（DB の date 型・フォームの value）
export function formatPlainDate(d: PlainDate): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${String(d.year).padStart(4, "0")}-${mm}-${dd}`;
}

// "YYYY-MM-DD" を読む。形が違う・存在しない日付なら null
export function parsePlainDate(value: string): PlainDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidPlainDate(d) ? d : null;
}

// a < b なら負、同じなら 0、a > b なら正
export function comparePlainDate(a: PlainDate, b: PlainDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

// 「9月17日（木）」の形（§4.3「日付には曜日を付ける」）。年は付けない（年をまたぐときは呼ぶ側で足す）
export function formatDateWithWeekday(d: PlainDate): string {
  const weekday = WEEKDAYS_JA[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
  return `${d.month}月${d.day}日（${weekday}）`;
}
