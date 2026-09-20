import { comparePlainDate, type PlainDate } from "@/lib/date";
import { readDateField } from "@/lib/tournaments/tournament-input";

// 年度更新の受付の入力（設計書 §5.12「受付開始」）。画面とサーバーの両方で使う
// 日付だけで入力し、開始はその日の 0:00、締切はその日の 23:59:59（日本時間）にする（§5.4 と同じ）
// 画面には「来年度」「次年度」と書かず、年度の数字で書く（§4.4）

// 受け付ける年度の幅。打ち間違い（20227 など）を弾くだけ
export const PERIOD_YEAR_MIN = 2020;
export const PERIOD_YEAR_MAX = 2100;

export type PeriodInput = { year: number; opensDate: PlainDate; closesDate: PlainDate; autoApprove: boolean };
export type PeriodField = "year" | "opensDate" | "closesDate" | "autoApprove";

export type PeriodInputResult = { ok: true; value: PeriodInput } | { ok: false; field: PeriodField; message: string };

const fail = (field: PeriodField, message: string): PeriodInputResult => ({ ok: false, field, message });

export function parsePeriodInput(raw: Record<string, unknown>): PeriodInputResult {
  const year = Number(typeof raw.year === "string" ? raw.year.trim() : raw.year);
  if (!Number.isInteger(year) || year < PERIOD_YEAR_MIN || year > PERIOD_YEAR_MAX) {
    return fail("year", "年度を 4 けたの数で入力してください");
  }

  const opensDate = readDateField(raw.opensDate);
  if (opensDate === "invalid" || opensDate === null) return fail("opensDate", "受付の開始日を年月日で入力してください");

  const closesDate = readDateField(raw.closesDate);
  if (closesDate === "invalid" || closesDate === null) return fail("closesDate", "受付の締切日を年月日で入力してください");

  if (comparePlainDate(opensDate, closesDate) > 0) {
    return fail("closesDate", "締切日は開始日と同じ日か、それより後にしてください");
  }

  const autoApprove = raw.autoApprove === true || raw.autoApprove === "on" || raw.autoApprove === "true";
  return { ok: true, value: { year, opensDate, closesDate, autoApprove } };
}

// 画面の見出し（§4.4「年度の数字で書く」）
export function periodYearText(year: number): string {
  return `${year}年度`;
}
