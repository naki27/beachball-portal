import { describe, expect, it } from "vitest";
import { endOfDayTokyo, type PlainDate } from "@/lib/date";
import { deadlineText, deadlineTone } from "@/lib/tournaments/deadline-text";

const d = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

// 締切の見せ方（設計書 §5.6「9月30日（水）まで　あと5日」）
describe("deadlineText", () => {
  const deadline = endOfDayTokyo(d(2026, 9, 30));

  it("締切前は「◯月◯日（曜）まで　あと◯日」", () => {
    expect(deadlineText(deadline, new Date("2026-09-24T15:00:00Z"))).toBe("9月30日（水）まで　あと5日");
    expect(deadlineText(deadline, new Date("2026-09-29T12:00:00Z"))).toBe("9月30日（水）まで　あと1日");
  });

  it("当日は「今日までです」", () => {
    expect(deadlineText(deadline, new Date("2026-09-30T05:00:00Z"))).toBe("9月30日（水）まで　今日までです");
  });

  it("過ぎていれば「締め切りました」（サーバーの TZ が UTC でも日本時間で数える）", () => {
    expect(deadlineText(deadline, new Date(deadline.getTime() + 1))).toBe("9月30日（水）に締め切りました");
  });
});

// 締切が近いほど強い色にする（§4.5「あと3日」以内は橙、当日は赤）
describe("deadlineTone", () => {
  const deadline = endOfDayTokyo(d(2026, 9, 30));

  it("4 日以上あれば normal、3 日以内は soon", () => {
    expect(deadlineTone(deadline, new Date("2026-09-25T15:00:00Z"))).toBe("normal"); // あと4日
    expect(deadlineTone(deadline, new Date("2026-09-26T15:00:00Z"))).toBe("soon"); // あと3日
    expect(deadlineTone(deadline, new Date("2026-09-29T12:00:00Z"))).toBe("soon");
  });

  it("当日は today、過ぎていれば past", () => {
    expect(deadlineTone(deadline, new Date("2026-09-30T05:00:00Z"))).toBe("today");
    expect(deadlineTone(deadline, new Date(deadline.getTime() + 1))).toBe("past");
  });
});
