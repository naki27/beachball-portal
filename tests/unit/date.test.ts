import { describe, expect, it } from "vitest";
import {
  comparePlainDate,
  diffDays,
  endOfDayTokyo,
  fiscalYear,
  formatDateWithWeekday,
  formatPlainDate,
  isValidPlainDate,
  formatDateTimeTokyo,
  formatTimestampTokyo,
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

describe("formatDateWithWeekday", () => {
  it("「9月17日（木）」の形。曜日は暦どおり", () => {
    expect(formatDateWithWeekday({ year: 2026, month: 1, day: 1 })).toBe("1月1日（木）");
    expect(formatDateWithWeekday({ year: 2026, month: 9, day: 30 })).toBe("9月30日（水）");
    expect(formatDateWithWeekday({ year: 2027, month: 1, day: 31 })).toBe("1月31日（日）");
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

describe("diffDays", () => {
  it("暦の上の日数の差（同じ日は 0・後の日は正・前の日は負）", () => {
    const base = { year: 2026, month: 9, day: 30 };
    expect(diffDays(base, base)).toBe(0);
    expect(diffDays(base, { year: 2026, month: 10, day: 5 })).toBe(5);
    expect(diffDays(base, { year: 2026, month: 9, day: 25 })).toBe(-5);
    // 月・年をまたいでも、うるう年でも数えられる（TZ・サマータイムに影響されない）
    expect(diffDays({ year: 2026, month: 12, day: 31 }, { year: 2027, month: 1, day: 1 })).toBe(1);
    expect(diffDays({ year: 2028, month: 2, day: 28 }, { year: 2028, month: 3, day: 1 })).toBe(2);
  });
});

describe("fiscalYear", () => {
  it("開始月が 4 なら 4/1〜翌 3/31 が同じ年度（§5.12）", () => {
    expect(fiscalYear({ year: 2026, month: 4, day: 1 }, 4)).toBe(2026);
    expect(fiscalYear({ year: 2026, month: 12, day: 31 }, 4)).toBe(2026);
    expect(fiscalYear({ year: 2027, month: 3, day: 31 }, 4)).toBe(2026);
    expect(fiscalYear({ year: 2027, month: 4, day: 1 }, 4)).toBe(2027);
  });

  it("協会ごとに開始月が違う（1 月始まりなら暦年と同じ）", () => {
    expect(fiscalYear({ year: 2026, month: 1, day: 1 }, 1)).toBe(2026);
    expect(fiscalYear({ year: 2026, month: 12, day: 31 }, 1)).toBe(2026);
    // 10 月始まり
    expect(fiscalYear({ year: 2026, month: 9, day: 30 }, 10)).toBe(2025);
    expect(fiscalYear({ year: 2026, month: 10, day: 1 }, 10)).toBe(2026);
  });
});

describe("日時の表示（§5.13 の CSV・記録）", () => {
  it("日本時間の「YYYY-MM-DD HH:MM」。サーバーの TZ に関係なく同じ", () => {
    expect(formatDateTimeTokyo(new Date("2026-09-20T03:04:00Z"))).toBe("2026-09-20 12:04");
    // 日本時間では翌日の 0:30
    expect(formatDateTimeTokyo(new Date("2026-09-20T15:30:00Z"))).toBe("2026-09-21 00:30");
  });
});

describe("記録の時刻（操作ログ）", () => {
  it("日本時間の ISO 8601（ミリ秒まで）。サーバーの TZ に関係なく同じ", () => {
    expect(formatTimestampTokyo(new Date("2026-09-21T03:34:56.789Z"))).toBe("2026-09-21T12:34:56.789+09:00");
    // 日本時間では翌日の 0:00
    expect(formatTimestampTokyo(new Date("2026-09-20T15:00:00.000Z"))).toBe("2026-09-21T00:00:00.000+09:00");
  });
});
