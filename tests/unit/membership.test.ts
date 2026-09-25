import { describe, expect, it } from "vitest";
import { fiscalYearEndOf, fiscalYearOf, isApproved, membershipDisplayLabel, membershipDisplayOf } from "@/lib/membership";

describe("fiscalYearEndOf（年度の末日・追加の申告の期限）", () => {
  it("4 月開始なら翌年 3 月 31 日。1 月開始は 12 月 31 日。うるう年の 2 月も正しい", () => {
    expect(fiscalYearEndOf(2027, 4)).toEqual({ year: 2028, month: 3, day: 31 });
    expect(fiscalYearEndOf(2027, 1)).toEqual({ year: 2027, month: 12, day: 31 });
    expect(fiscalYearEndOf(2027, 9)).toEqual({ year: 2028, month: 8, day: 31 });
    expect(fiscalYearEndOf(2027, 3)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(fiscalYearEndOf(2026, 3)).toEqual({ year: 2027, month: 2, day: 28 });
  });
});

// 会員判定の純粋な部分（設計書 §5.12・付録 F・D-01）。DB を読む isMember / membershipDisplays は tests/db/membership.test.ts

describe("fiscalYearOf（年度 = 開始年）", () => {
  it("4 月開始なら 3/31 は前年度、4/1 は当年度", () => {
    expect(fiscalYearOf({ year: 2027, month: 3, day: 31 }, 4)).toBe(2026);
    expect(fiscalYearOf({ year: 2027, month: 4, day: 1 }, 4)).toBe(2027);
  });

  it("開始月がほかの月でも同じ規則（1 月開始は暦年）", () => {
    expect(fiscalYearOf({ year: 2027, month: 1, day: 1 }, 1)).toBe(2027);
    expect(fiscalYearOf({ year: 2027, month: 12, day: 31 }, 1)).toBe(2027);
    expect(fiscalYearOf({ year: 2027, month: 8, day: 31 }, 9)).toBe(2026);
    expect(fiscalYearOf({ year: 2027, month: 9, day: 1 }, 9)).toBe(2027);
  });
});

describe("isApproved", () => {
  it("approved だけが会員。applied はまだ会員ではない", () => {
    expect(isApproved({ status: "approved" })).toBe(true);
    expect(isApproved({ status: "applied" })).toBe(false);
    expect(isApproved({ status: "declined" })).toBe(false);
    expect(isApproved({ status: "expired" })).toBe(false);
    expect(isApproved(null)).toBe(false);
    expect(isApproved(undefined)).toBe(false);
  });
});

describe("membershipDisplayOf（表示のしかた）", () => {
  const closesAt = new Date("2027-06-30T14:59:59.999Z"); // 日本時間 6/30 23:59:59
  const during = new Date("2027-05-01T00:00:00Z");
  const after = new Date("2027-07-01T00:00:00Z");
  const period = { closesAt };

  it("受付も取り込みもない年度は no_data（行があっても出さない）", () => {
    expect(membershipDisplayOf({ period: null, imported: false, row: null, lastYearRow: null }, during)).toBe("no_data");
    expect(membershipDisplayOf({ period: null, imported: false, row: { status: "approved" }, lastYearRow: null }, during)).toBe("no_data");
  });

  it("取り込みだけの年度でも判定する", () => {
    expect(membershipDisplayOf({ period: null, imported: true, row: { status: "approved" }, lastYearRow: null }, during)).toBe("member");
    expect(membershipDisplayOf({ period: null, imported: true, row: null, lastYearRow: { status: "approved" } }, during)).toBe("not_member");
  });

  it("approved は member、applied は pending、declined・expired は not_member", () => {
    expect(membershipDisplayOf({ period, imported: false, row: { status: "approved" }, lastYearRow: null }, during)).toBe("member");
    expect(membershipDisplayOf({ period, imported: false, row: { status: "applied" }, lastYearRow: null }, during)).toBe("pending");
    expect(membershipDisplayOf({ period, imported: false, row: { status: "declined" }, lastYearRow: { status: "approved" } }, during)).toBe("not_member");
    expect(membershipDisplayOf({ period, imported: false, row: { status: "expired" }, lastYearRow: null }, during)).toBe("not_member");
  });

  it("受付期間中で昨年度 approved・今年度なしは renewal_pending。締切の瞬間まで", () => {
    const facts = { period, imported: false, row: null, lastYearRow: { status: "approved" as const } };
    expect(membershipDisplayOf(facts, during)).toBe("renewal_pending");
    expect(membershipDisplayOf(facts, closesAt)).toBe("renewal_pending");
    expect(membershipDisplayOf(facts, new Date(closesAt.getTime() + 1))).toBe("not_member");
    expect(membershipDisplayOf(facts, after)).toBe("not_member");
  });

  it("昨年度が approved でなければ受付中でも not_member", () => {
    expect(membershipDisplayOf({ period, imported: false, row: null, lastYearRow: { status: "applied" } }, during)).toBe("not_member");
    expect(membershipDisplayOf({ period, imported: false, row: null, lastYearRow: null }, during)).toBe("not_member");
  });
});

describe("membershipDisplayLabel（§4.4）", () => {
  it("年度の数字で書く。no_data は出さない", () => {
    expect(membershipDisplayLabel("member", 2027)).toBe("協会員（2027年度）");
    expect(membershipDisplayLabel("pending", 2027)).toBe("運営の確認待ち");
    expect(membershipDisplayLabel("renewal_pending", 2027)).toBe("更新の受付中（昨年度は協会員）");
    expect(membershipDisplayLabel("not_member", 2027)).toBe("協会員ではない");
    expect(membershipDisplayLabel("no_data", 2027)).toBeNull();
  });
});
