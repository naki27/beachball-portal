import { comparePlainDate, type PlainDate } from "@/lib/date";
import { readDateField } from "@/lib/tournaments/tournament-input";

// 年度更新の受付（membership_periods）の入力の検査（設計書 §5.12「受付開始」）。画面と API で同じ規則
// 日付だけで入力し、開始はその日の 0:00、締切はその日の 23:59:59（日本時間・§5.4 と同じ）。変換は repo/admin 側

export const MEMBERSHIP_YEAR_MIN = 2000;
export const MEMBERSHIP_YEAR_MAX = 2100;

export type PeriodInput = {
  year: number;
  opensDate: PlainDate;
  closesDate: PlainDate;
  autoApprove: boolean;
};

export type PeriodField = keyof PeriodInput;

export type PeriodInputResult = { ok: true; value: PeriodInput } | { ok: false; field: PeriodField; message: string };

export function parsePeriodInput(raw: Record<string, unknown>): PeriodInputResult {
  const year = typeof raw.year === "number" ? raw.year : Number(String(raw.year ?? "").trim());
  if (!Number.isInteger(year) || year < MEMBERSHIP_YEAR_MIN || year > MEMBERSHIP_YEAR_MAX) {
    return { ok: false, field: "year", message: "対象年度を西暦の 4 けたで入力してください" };
  }
  const opensDate = readDateField(raw.opensDate);
  if (!opensDate || opensDate === "invalid") return { ok: false, field: "opensDate", message: "受付の開始日を入力してください" };
  const closesDate = readDateField(raw.closesDate);
  if (!closesDate || closesDate === "invalid") return { ok: false, field: "closesDate", message: "受付の締切日を入力してください" };
  if (comparePlainDate(closesDate, opensDate) < 0) return { ok: false, field: "closesDate", message: "締切日は開始日以降にしてください" };
  const autoApprove = raw.autoApprove === true || raw.autoApprove === "true" || raw.autoApprove === "on";
  return { ok: true, value: { year, opensDate, closesDate, autoApprove } };
}

// 画面の言い方（§4.4: 「来年度」「次年度」とは書かず、年度の数字で書く）
export function fiscalYearLabel(year: number): string {
  return `${year}年度`;
}
