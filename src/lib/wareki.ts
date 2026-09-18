// 生年月日の入力（和暦・設計書 §4.3「生年月日の入力」）の純粋な処理。画面の部品は src/components/ui/birth-date-field.tsx
// 元号: 昭和 1926-12-25〜1989-01-07、平成 1989-01-08〜2019-04-30、令和 2019-05-01〜。「元年」は 1 年として入力する
// 年齢は age.ts、今日は date.ts の todayInTokyo() から（ここでは受け取るだけ）

import { ageAt } from "./age";
import { comparePlainDate, isValidPlainDate, type PlainDate } from "./date";

export type EraId = "showa" | "heisei" | "reiwa" | "seireki";

type Era = { id: Exclude<EraId, "seireki">; label: string; start: PlainDate; end: PlainDate | null };

const ERAS: readonly Era[] = [
  { id: "showa", label: "昭和", start: { year: 1926, month: 12, day: 25 }, end: { year: 1989, month: 1, day: 7 } },
  { id: "heisei", label: "平成", start: { year: 1989, month: 1, day: 8 }, end: { year: 2019, month: 4, day: 30 } },
  { id: "reiwa", label: "令和", start: { year: 2019, month: 5, day: 1 }, end: null },
];

// ボタンの並び（§4.3: 昭和・平成・令和・西暦。既定は昭和【仮】）
export const ERA_CHOICES: readonly { id: EraId; label: string }[] = [
  ...ERAS.map((e) => ({ id: e.id, label: e.label })),
  { id: "seireki", label: "西暦" },
];
export const DEFAULT_ERA: EraId = "showa";

// 西暦で受け付ける最も古い年（これより前は打ち間違いとみなす）
const SEIREKI_MIN_YEAR = 1900;

// 今日時点でこの年齢なら「◯歳で合っていますか？」と確かめる（§4.3: 15 歳未満か 80 歳以上）
export function needsAgeConfirmation(age: number): boolean {
  return age < 15 || age >= 80;
}

function eraOf(id: Exclude<EraId, "seireki">): Era {
  const era = ERAS.find((e) => e.id === id);
  if (!era) throw new Error(`unknown era: ${id}`);
  return era;
}

function yearLabel(era: Era, year: number): string {
  return `${era.label}${year === 1 ? "元" : year}年`;
}

function monthDayLabel(d: PlainDate): string {
  return `${d.month}月${d.day}日`;
}

// その日の元号と和暦の年（昭和より前は null）
export function warekiOf(d: PlainDate): { era: Exclude<EraId, "seireki">; year: number } | null {
  for (let i = ERAS.length - 1; i >= 0; i--) {
    const era = ERAS[i];
    if (comparePlainDate(d, era.start) >= 0) return { era: era.id, year: d.year - era.start.year + 1 };
  }
  return null;
}

// 「昭和40年」「平成元年」。昭和より前は null
export function formatWarekiYear(d: PlainDate): string | null {
  const w = warekiOf(d);
  return w ? yearLabel(eraOf(w.era), w.year) : null;
}

// 確認ページの表示「1965年（昭和40年）5月3日」（§4.3）
export function formatBirthDateLong(d: PlainDate): string {
  const wareki = formatWarekiYear(d);
  return `${d.year}年${wareki ? `（${wareki}）` : ""}${monthDayLabel(d)}`;
}

export type BirthDateParts = { era: EraId; year: string; month: string; day: string };

export type BirthDateField = "year" | "month" | "day";

export type BirthDateParse =
  // まだ打ち終わっていない（誤りも出さない）
  | { status: "incomplete" }
  | { status: "error"; field: BirthDateField; message: string }
  | { status: "ok"; date: PlainDate; age: number; needsConfirmation: boolean };

// 数字の欄を読む。全角の数字も受ける。空なら null、数字以外が混ざれば NaN
function readNumber(value: string): number | null {
  const s = value.normalize("NFKC").trim();
  if (s === "") return null;
  return /^\d+$/.test(s) ? Number(s) : Number.NaN;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// 入力の途中でも、分かった時点で誤りを返す（§4.3「元号の範囲外はその場でエラー」）
export function parseBirthDateParts(parts: BirthDateParts, today: PlainDate): BirthDateParse {
  const year = readNumber(parts.year);
  const month = readNumber(parts.month);
  const day = readNumber(parts.day);

  // 年
  let westernYear: number | null = null;
  if (year !== null) {
    if (Number.isNaN(year)) return { status: "error", field: "year", message: "年は数字で入力してください" };
    if (year < 1) return { status: "error", field: "year", message: "年は1以上で入力してください（元年は1）" };
    if (parts.era === "seireki") {
      // 4 けたになるまでは打っている途中
      if (parts.year.normalize("NFKC").trim().length >= 4) {
        if (year < SEIREKI_MIN_YEAR || year > today.year) {
          return { status: "error", field: "year", message: `西暦は${SEIREKI_MIN_YEAR}年から${today.year}年までで入力してください` };
        }
        westernYear = year;
      }
    } else {
      const era = eraOf(parts.era);
      const lastYear = (era.end ?? today).year - era.start.year + 1;
      if (year > lastYear) {
        return { status: "error", field: "year", message: `${era.label}は${lastYear}年までです` };
      }
      westernYear = era.start.year + year - 1;
    }
  }

  // 月
  if (month !== null && (Number.isNaN(month) || month < 1 || month > 12)) {
    return { status: "error", field: "month", message: "月は1から12で入力してください" };
  }

  // 日
  if (day !== null) {
    const max = westernYear !== null && month !== null ? daysInMonth(westernYear, month) : 31;
    if (Number.isNaN(day) || day < 1 || day > max) {
      return {
        status: "error",
        field: "day",
        message: max === 31 ? "日は1から31で入力してください" : `${month}月は${max}日までです`,
      };
    }
  }

  if (westernYear === null || month === null || day === null) return { status: "incomplete" };
  const date: PlainDate = { year: westernYear, month, day };
  if (!isValidPlainDate(date)) return { status: "error", field: "day", message: "ない日付です" };

  // 元号の範囲（昭和64年1月8日・平成元年1月7日・平成31年5月1日・令和元年4月30日 などは誤り）
  if (parts.era !== "seireki") {
    const era = eraOf(parts.era);
    if (comparePlainDate(date, era.start) < 0) {
      return { status: "error", field: "day", message: `${era.label}は元年${monthDayLabel(era.start)}からです` };
    }
    if (era.end && comparePlainDate(date, era.end) > 0) {
      const endYear = era.end.year - era.start.year + 1;
      return { status: "error", field: "day", message: `${yearLabel(era, endYear)}は${monthDayLabel(era.end)}までです` };
    }
  }

  if (comparePlainDate(date, today) > 0) return { status: "error", field: "day", message: "今日より後の日付になっています" };

  const age = ageAt(date, today);
  return { status: "ok", date, age, needsConfirmation: needsAgeConfirmation(age) };
}

// 入力のそばに出す「（1965年）・61歳」（§4.3）。西暦で入れたときは和暦を添える「（昭和40年）・61歳」
export function describeBirthDate(date: PlainDate, age: number, era: EraId): string {
  const other = era === "seireki" ? formatWarekiYear(date) : `${date.year}年`;
  return `${other ? `（${other}）・` : ""}${age}歳`;
}

// 保存済みの生年月日から、入力欄の初めの値を作る（和暦で表せればその元号、昭和より前は西暦）
export function partsFromDate(d: PlainDate): BirthDateParts {
  const w = warekiOf(d);
  return {
    era: w ? w.era : "seireki",
    year: String(w ? w.year : d.year),
    month: String(d.month),
    day: String(d.day),
  };
}
