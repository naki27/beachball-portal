import { describe, expect, it } from "vitest";
import { ageAt } from "@/lib/age";
import type { PlainDate } from "@/lib/date";

const d = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

// 年齢（付録 D）。誕生日の当日に 1 つ増える。Date・TZ を使わないので TZ=UTC でも同じ
describe("ageAt", () => {
  it("誕生日の前日・当日・翌日", () => {
    const birth = d(1965, 5, 3);
    expect(ageAt(birth, d(2026, 5, 2))).toBe(60);
    expect(ageAt(birth, d(2026, 5, 3))).toBe(61);
    expect(ageAt(birth, d(2026, 5, 4))).toBe(61);
  });

  it("年をまたぐ前後（12 月 31 日生まれ・1 月 1 日生まれ）", () => {
    expect(ageAt(d(2000, 12, 31), d(2026, 12, 30))).toBe(25);
    expect(ageAt(d(2000, 12, 31), d(2026, 12, 31))).toBe(26);
    expect(ageAt(d(2000, 1, 1), d(2025, 12, 31))).toBe(25);
    expect(ageAt(d(2000, 1, 1), d(2026, 1, 1))).toBe(26);
  });

  it("2 月 29 日生まれは、平年は 2 月 28 日ではまだ増えず 3 月 1 日に増える。うるう年は 2 月 29 日に増える", () => {
    const birth = d(2008, 2, 29);
    expect(ageAt(birth, d(2026, 2, 28))).toBe(17);
    expect(ageAt(birth, d(2026, 3, 1))).toBe(18);
    expect(ageAt(birth, d(2028, 2, 28))).toBe(19);
    expect(ageAt(birth, d(2028, 2, 29))).toBe(20);
  });

  it("生まれた日は 0 歳", () => {
    expect(ageAt(d(2026, 9, 18), d(2026, 9, 18))).toBe(0);
  });
});
