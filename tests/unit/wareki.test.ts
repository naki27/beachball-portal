import { describe, expect, it } from "vitest";
import type { PlainDate } from "@/lib/date";
import {
  type BirthDateParts,
  DEFAULT_ERA,
  describeBirthDate,
  type EraId,
  ERA_CHOICES,
  formatBirthDateLong,
  formatWarekiYear,
  needsAgeConfirmation,
  parseBirthDateParts,
  partsFromDate,
} from "@/lib/wareki";

// 生年月日の入力（和暦・設計書 §4.3）。今日は固定する
const TODAY: PlainDate = { year: 2026, month: 9, day: 18 };
const parse = (era: EraId, year: string, month: string, day: string) => parseBirthDateParts({ era, year, month, day }, TODAY);

describe("元号のボタン", () => {
  it("昭和・平成・令和・西暦の順で、既定は昭和", () => {
    expect(ERA_CHOICES.map((c) => c.label)).toEqual(["昭和", "平成", "令和", "西暦"]);
    expect(DEFAULT_ERA).toBe("showa");
  });
});

describe("parseBirthDateParts: 元号の境界", () => {
  it.each([
    ["showa", "64", "1", "7", { year: 1989, month: 1, day: 7 }],
    ["heisei", "1", "1", "8", { year: 1989, month: 1, day: 8 }],
    ["heisei", "31", "4", "30", { year: 2019, month: 4, day: 30 }],
    ["reiwa", "1", "5", "1", { year: 2019, month: 5, day: 1 }],
    ["showa", "1", "12", "25", { year: 1926, month: 12, day: 25 }],
  ] as const)("%s %s年%s月%s日 は正しい", (era, y, m, day, expected) => {
    expect(parse(era, y, m, day)).toMatchObject({ status: "ok", date: expected });
  });

  it.each([
    ["showa", "64", "1", "8", "昭和64年は1月7日までです"],
    ["heisei", "1", "1", "7", "平成は元年1月8日からです"],
    ["heisei", "31", "5", "1", "平成31年は4月30日までです"],
    ["reiwa", "1", "4", "30", "令和は元年5月1日からです"],
    ["showa", "1", "12", "24", "昭和は元年12月25日からです"],
  ] as const)("%s %s年%s月%s日 は元号の範囲外", (era, y, m, day, message) => {
    expect(parse(era, y, m, day)).toEqual({ status: "error", field: "day", message });
  });
});

describe("parseBirthDateParts: その場の誤り", () => {
  it("元号の年の上限を超えたら、月・日を入れる前に年の欄で誤り（昭和65年など）", () => {
    expect(parse("showa", "65", "", "")).toEqual({ status: "error", field: "year", message: "昭和は64年までです" });
    expect(parse("heisei", "32", "", "")).toEqual({ status: "error", field: "year", message: "平成は31年までです" });
    // 令和は今日の年まで（2026 年 = 令和8年）
    expect(parse("reiwa", "9", "", "")).toEqual({ status: "error", field: "year", message: "令和は8年までです" });
  });

  it("月・日の範囲。その月の日数で確かめる", () => {
    expect(parse("showa", "40", "13", "")).toMatchObject({ status: "error", field: "month" });
    expect(parse("showa", "40", "2", "29")).toEqual({ status: "error", field: "day", message: "2月は28日までです" });
    expect(parse("showa", "39", "2", "29")).toMatchObject({ status: "ok", date: { year: 1964, month: 2, day: 29 } });
    expect(parse("showa", "", "", "32")).toEqual({ status: "error", field: "day", message: "日は1から31で入力してください" });
  });

  it("数字以外・0 は誤り", () => {
    expect(parse("showa", "四十", "", "")).toMatchObject({ status: "error", field: "year" });
    expect(parse("showa", "0", "", "")).toMatchObject({ status: "error", field: "year" });
    expect(parse("showa", "40", "0", "")).toMatchObject({ status: "error", field: "month" });
  });

  it("今日より後の日付は誤り", () => {
    expect(parse("reiwa", "8", "9", "19")).toEqual({ status: "error", field: "day", message: "今日より後の日付になっています" });
    expect(parse("reiwa", "8", "9", "18")).toMatchObject({ status: "ok" });
  });

  it("打っている途中は誤りを出さない（西暦は 4 けたになるまで）", () => {
    expect(parse("showa", "40", "5", "")).toEqual({ status: "incomplete" });
    expect(parse("seireki", "196", "5", "3")).toEqual({ status: "incomplete" });
    expect(parse("seireki", "1965", "5", "3")).toMatchObject({ status: "ok", date: { year: 1965, month: 5, day: 3 } });
    expect(parse("seireki", "1899", "", "")).toMatchObject({ status: "error", field: "year" });
    expect(parse("seireki", "2027", "", "")).toMatchObject({ status: "error", field: "year" });
  });

  it("「元年」は 1。全角の数字も受ける", () => {
    expect(parse("heisei", "1", "2", "1")).toMatchObject({ status: "ok", date: { year: 1989, month: 2, day: 1 } });
    expect(parse("showa", "４０", "５", "３")).toMatchObject({ status: "ok", date: { year: 1965, month: 5, day: 3 } });
  });
});

describe("年齢の確認（今日時点で 15 歳未満か 80 歳以上）", () => {
  it("境界", () => {
    expect(needsAgeConfirmation(14)).toBe(true);
    expect(needsAgeConfirmation(15)).toBe(false);
    expect(needsAgeConfirmation(79)).toBe(false);
    expect(needsAgeConfirmation(80)).toBe(true);
  });

  it("昭和5年と平成5年を入れ比べる（平成のつもりで昭和のまま入れた誤りに気づける）", () => {
    expect(parse("showa", "5", "4", "1")).toMatchObject({ status: "ok", age: 96, needsConfirmation: true });
    expect(parse("heisei", "5", "4", "1")).toMatchObject({ status: "ok", age: 33, needsConfirmation: false });
  });

  it("誕生日の前日・当日で 15 歳・80 歳の境目", () => {
    // 2011-09-18 生まれ: 今日 15 歳ちょうど → 確かめない。1 日遅いと 14 歳 → 確かめる
    expect(parse("seireki", "2011", "9", "18")).toMatchObject({ age: 15, needsConfirmation: false });
    expect(parse("seireki", "2011", "9", "19")).toMatchObject({ age: 14, needsConfirmation: true });
    expect(parse("showa", "21", "9", "18")).toMatchObject({ age: 80, needsConfirmation: true });
    expect(parse("showa", "21", "9", "19")).toMatchObject({ age: 79, needsConfirmation: false });
  });
});

describe("表示", () => {
  it("入力のそば: 「（1965年）・61歳」。西暦で入れたら和暦を添える", () => {
    const date = { year: 1965, month: 5, day: 3 };
    expect(describeBirthDate(date, 61, "showa")).toBe("（1965年）・61歳");
    expect(describeBirthDate(date, 61, "seireki")).toBe("（昭和40年）・61歳");
  });

  it("確認ページ: 「1965年（昭和40年）5月3日」。1 年は元年", () => {
    expect(formatBirthDateLong({ year: 1965, month: 5, day: 3 })).toBe("1965年（昭和40年）5月3日");
    expect(formatBirthDateLong({ year: 1989, month: 1, day: 7 })).toBe("1989年（昭和64年）1月7日");
    expect(formatBirthDateLong({ year: 1989, month: 1, day: 8 })).toBe("1989年（平成元年）1月8日");
    expect(formatBirthDateLong({ year: 2019, month: 4, day: 30 })).toBe("2019年（平成31年）4月30日");
    expect(formatBirthDateLong({ year: 2019, month: 5, day: 1 })).toBe("2019年（令和元年）5月1日");
    expect(formatBirthDateLong({ year: 1920, month: 1, day: 1 })).toBe("1920年1月1日");
    expect(formatWarekiYear({ year: 1926, month: 12, day: 24 })).toBeNull();
  });

  it("保存済みの値から入力欄を埋める（その日の元号）", () => {
    const cases: [PlainDate, BirthDateParts][] = [
      [{ year: 1965, month: 5, day: 3 }, { era: "showa", year: "40", month: "5", day: "3" }],
      [{ year: 1989, month: 1, day: 8 }, { era: "heisei", year: "1", month: "1", day: "8" }],
      [{ year: 2020, month: 1, day: 1 }, { era: "reiwa", year: "2", month: "1", day: "1" }],
      [{ year: 1920, month: 1, day: 1 }, { era: "seireki", year: "1920", month: "1", day: "1" }],
    ];
    for (const [date, parts] of cases) {
      expect(partsFromDate(date)).toEqual(parts);
      expect(parseBirthDateParts(parts, TODAY)).toMatchObject({ status: "ok", date });
    }
  });
});
