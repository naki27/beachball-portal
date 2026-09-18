import { describe, expect, it } from "vitest";
import {
  comparePlainDate,
  endOfDayTokyo,
  formatPlainDate,
  isValidPlainDate,
  parsePlainDate,
  startOfDayTokyo,
  todayInTokyo,
} from "@/lib/date";

// 瞬間（UTC の ISO 文字列）を固定して確かめる。`pnpm test` は TZ=UTC と TZ=Asia/Tokyo の両方で流す（§7.0）
describe("todayInTokyo", () => {
  it("日本時間の年月日を返す（日付の境界は UTC の 15:00）", () => {
    expect(todayInTokyo(new Date("2026-01-01T14:59:59.999Z"))).toEqual({ year: 2026, month: 1, day: 1 });
    expect(todayInTokyo(new Date("2026-01-01T15:00:00.000Z"))).toEqual({ year: 2026, month: 1, day: 2 });
  });

  it("年をまたぐ", () => {
    expect(todayInTokyo(new Date("2025-12-31T14:59:59.999Z"))).toEqual({ year: 2025, month: 12, day: 31 });
    expect(todayInTokyo(new Date("2025-12-31T15:00:00.000Z"))).toEqual({ year: 2026, month: 1, day: 1 });
  });

  it("引数なしなら今を使う", () => {
    const today = todayInTokyo();
    expect(isValidPlainDate(today)).toBe(true);
  });
});

describe("startOfDayTokyo / endOfDayTokyo", () => {
  const d = { year: 2026, month: 1, day: 31 };

  it("日本時間の 0:00 と 23:59:59.999 の瞬間", () => {
    expect(startOfDayTokyo(d).toISOString()).toBe("2026-01-30T15:00:00.000Z");
    expect(endOfDayTokyo(d).toISOString()).toBe("2026-01-31T14:59:59.999Z");
  });

  it("その瞬間を日本時間の日付に戻すと同じ日。1 ミリ秒前は前日、1 ミリ秒後は翌日", () => {
    expect(todayInTokyo(startOfDayTokyo(d))).toEqual(d);
    expect(todayInTokyo(endOfDayTokyo(d))).toEqual(d);
    expect(todayInTokyo(new Date(startOfDayTokyo(d).getTime() - 1))).toEqual({ year: 2026, month: 1, day: 30 });
    expect(todayInTokyo(new Date(endOfDayTokyo(d).getTime() + 1))).toEqual({ year: 2026, month: 2, day: 1 });
  });
});

describe("formatPlainDate / parsePlainDate", () => {
  it("YYYY-MM-DD と相互に変換する", () => {
    expect(formatPlainDate({ year: 2026, month: 4, day: 1 })).toBe("2026-04-01");
    expect(parsePlainDate("2026-04-01")).toEqual({ year: 2026, month: 4, day: 1 });
    expect(parsePlainDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it("形が違う・存在しない日付は null", () => {
    expect(parsePlainDate("2026-4-1")).toBeNull();
    expect(parsePlainDate("20260401")).toBeNull();
    expect(parsePlainDate("2026-02-30")).toBeNull();
    expect(parsePlainDate("2023-02-29")).toBeNull();
    expect(parsePlainDate("2026-13-01")).toBeNull();
    expect(parsePlainDate("")).toBeNull();
  });

  it("isValidPlainDate", () => {
    expect(isValidPlainDate({ year: 2026, month: 12, day: 31 })).toBe(true);
    expect(isValidPlainDate({ year: 2026, month: 0, day: 1 })).toBe(false);
    expect(isValidPlainDate({ year: 2026, month: 1, day: 1.5 })).toBe(false);
  });
});

describe("comparePlainDate", () => {
  it("年 → 月 → 日の順に比べる", () => {
    const a = { year: 2026, month: 3, day: 31 };
    expect(comparePlainDate(a, { year: 2026, month: 4, day: 1 })).toBeLessThan(0);
    expect(comparePlainDate(a, { year: 2025, month: 12, day: 31 })).toBeGreaterThan(0);
    expect(comparePlainDate(a, { ...a })).toBe(0);
  });
});
