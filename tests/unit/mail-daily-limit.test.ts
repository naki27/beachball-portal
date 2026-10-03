import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAIL_DAILY_LIMIT,
  dailyLimitAlert,
  mailDailyLimit,
  sentTodayWindow,
  warnThreshold,
} from "@/lib/mail/daily-limit";

// 1 日の送信数の 8 割の警告（設計書 §11.2・X-01）。日付は日本時間で数える（§7.0）

describe("上限と警告の件数", () => {
  it("MAIL_DAILY_LIMIT がなければ 300", () => {
    expect(mailDailyLimit({})).toBe(DEFAULT_MAIL_DAILY_LIMIT);
    expect(mailDailyLimit({ MAIL_DAILY_LIMIT: "" })).toBe(300);
    expect(mailDailyLimit({ MAIL_DAILY_LIMIT: "0" })).toBe(300);
    expect(mailDailyLimit({ MAIL_DAILY_LIMIT: "なにか" })).toBe(300);
    expect(mailDailyLimit({ MAIL_DAILY_LIMIT: "150" })).toBe(150);
  });

  it("8 割。端数は切り上げ", () => {
    expect(warnThreshold(300)).toBe(240);
    expect(warnThreshold(10)).toBe(8);
    expect(warnThreshold(7)).toBe(6); // 5.6 → 6
  });
});

describe("跨いだ回だけ出す", () => {
  const now = new Date("2026-10-03T01:00:00Z");
  const alert = (before: number, after: number) => dailyLimitAlert({ before, after, limit: 300, now });

  it("8 割に届いていなければ出さない", () => {
    expect(alert(0, 239)).toBeNull();
  });

  it("8 割に届いた回に出す", () => {
    const line = alert(239, 240);
    expect(line).not.toBeNull();
    expect(JSON.parse(line ?? "{}")).toEqual({ alert: "mail_daily_limit", date: "2026-10-03", sent: 240, limit: 300, threshold: 240 });
  });

  it("もう届いていた回には出さない（同じ日に 1 回だけ）", () => {
    expect(alert(240, 260)).toBeNull();
    expect(alert(300, 300)).toBeNull();
  });

  it("一気に跨いでも出す", () => {
    expect(alert(10, 290)).not.toBeNull();
  });

  it("日本時間の日付が入る（日付の変わり目）", () => {
    const beforeMidnight = dailyLimitAlert({ before: 0, after: 240, limit: 300, now: new Date("2026-10-03T14:59:59Z") });
    const afterMidnight = dailyLimitAlert({ before: 0, after: 240, limit: 300, now: new Date("2026-10-03T15:00:00Z") });
    expect(JSON.parse(beforeMidnight ?? "{}").date).toBe("2026-10-03");
    expect(JSON.parse(afterMidnight ?? "{}").date).toBe("2026-10-04");
  });
});

describe("数える範囲", () => {
  it("日本時間のその日の 0:00〜23:59:59.999", () => {
    const { from, to } = sentTodayWindow(new Date("2026-10-03T05:00:00Z")); // 日本時間 10/3 14:00
    expect(from.toISOString()).toBe("2026-10-02T15:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-03T14:59:59.999Z");
  });

  it("日付の変わり目をまたぐと次の日の範囲になる", () => {
    const last = sentTodayWindow(new Date("2026-10-03T14:59:59.999Z"));
    const next = sentTodayWindow(new Date("2026-10-03T15:00:00.000Z"));
    expect(last.to.toISOString()).toBe("2026-10-03T14:59:59.999Z");
    expect(next.from.toISOString()).toBe("2026-10-03T15:00:00.000Z");
  });
});
