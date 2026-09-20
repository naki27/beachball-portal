import { describe, expect, it } from "vitest";
import {
  currentFiscalYear,
  decideMembershipDisplay,
  fiscalYearForTournament,
  fiscalYearOf,
  isMemberStatus,
  type MembershipFacts,
  membershipCsvText,
  membershipDisplayText,
  renewalState,
} from "@/lib/membership";

// 会員判定（設計書 §5.12・付録 F・D-01）。付録 F の必須ケースをすべて入れる
// 年度は開始年（2026 年度 = 2026/4〜2027/3）。TZ=UTC と TZ=Asia/Tokyo の両方で同じ結果になること

describe("年度（fiscalYearOf）", () => {
  it("開始月の前日と当日で切り替わる（4 月開始）", () => {
    expect(fiscalYearOf({ year: 2027, month: 3, day: 31 }, 4)).toBe(2026);
    expect(fiscalYearOf({ year: 2027, month: 4, day: 1 }, 4)).toBe(2027);
  });

  it("開始月が協会ごとに違っても同じ規則で数える", () => {
    expect(fiscalYearOf({ year: 2027, month: 1, day: 1 }, 1)).toBe(2027);
    expect(fiscalYearOf({ year: 2026, month: 12, day: 31 }, 1)).toBe(2026);
    // 10 月開始の協会: 9/30 は前年度、10/1 から新年度
    expect(fiscalYearOf({ year: 2027, month: 9, day: 30 }, 10)).toBe(2026);
    expect(fiscalYearOf({ year: 2027, month: 10, day: 1 }, 10)).toBe(2027);
  });

  it("今年度は日本時間の今日から数える（UTC で日付が戻る瞬間でもずれない）", () => {
    // 2027-04-01 00:30（日本時間）= 2027-03-31 15:30 UTC。日本時間では新年度
    expect(currentFiscalYear(4, new Date("2027-03-31T15:30:00Z"))).toBe(2027);
    // 2027-03-31 23:30（日本時間）= 2027-03-31 14:30 UTC。日本時間ではまだ前年度
    expect(currentFiscalYear(4, new Date("2027-03-31T14:30:00Z"))).toBe(2026);
  });

  it("申込一覧の年度は大会の開催日で決まる（3 月に申し込んで 4 月に開催なら新年度）", () => {
    expect(fiscalYearForTournament({ year: 2027, month: 4, day: 4 }, 4)).toBe(2027);
    expect(fiscalYearForTournament({ year: 2027, month: 3, day: 28 }, 4)).toBe(2026);
    // 開催日が未定なら今日の年度
    expect(fiscalYearForTournament(null, 4, new Date("2026-05-01T00:00:00Z"))).toBe(2026);
  });
});

describe("会員かどうか（isMember）", () => {
  it("approved だけが会員。applied はまだ会員ではない", () => {
    expect(isMemberStatus("approved")).toBe(true);
    expect(isMemberStatus("applied")).toBe(false);
    expect(isMemberStatus("declined")).toBe(false);
    expect(isMemberStatus("expired")).toBe(false);
    expect(isMemberStatus(null)).toBe(false);
  });
});

describe("表示の区分（membershipDisplay）", () => {
  // 2027 年度の受付は 2027-04-01〜2027-06-30（早良区協会・§5.12）
  const period = { closesAt: new Date("2027-06-30T14:59:59.999Z") }; // 日本時間 6/30 23:59:59.999
  const duringPeriod = new Date("2027-05-10T00:00:00Z");
  const afterPeriod = new Date("2027-07-01T00:00:00Z");
  const facts = (over: Partial<MembershipFacts> = {}): MembershipFacts => ({
    current: null,
    previous: null,
    period,
    imported: false,
    ...over,
  });

  it("受付も取り込みもない年度は no_data（画面に出さない・CSV は空欄）", () => {
    expect(decideMembershipDisplay(facts({ period: null }), duringPeriod)).toBe("no_data");
    // 昨年度が協会員でも、その年度のデータがなければ出さない
    expect(decideMembershipDisplay(facts({ period: null, previous: "approved" }), duringPeriod)).toBe("no_data");
    // 取り込みのデータがあれば出す
    expect(decideMembershipDisplay(facts({ period: null, imported: true }), duringPeriod)).toBe("not_member");
  });

  it("approved は member、applied は pending", () => {
    expect(decideMembershipDisplay(facts({ current: "approved" }), duringPeriod)).toBe("member");
    expect(decideMembershipDisplay(facts({ current: "applied" }), duringPeriod)).toBe("pending");
  });

  it("受付期間中で昨年度が協会員・今年度の行なしなら renewal_pending", () => {
    expect(decideMembershipDisplay(facts({ previous: "approved" }), duringPeriod)).toBe("renewal_pending");
    // 締切の瞬間までは「更新の受付中」
    expect(decideMembershipDisplay(facts({ previous: "approved" }), period.closesAt)).toBe("renewal_pending");
  });

  it("締切を過ぎたら not_member（昨年度が協会員でも）", () => {
    expect(decideMembershipDisplay(facts({ previous: "approved" }), afterPeriod)).toBe("not_member");
    expect(decideMembershipDisplay(facts({ previous: "approved" }), new Date(period.closesAt.getTime() + 1))).toBe("not_member");
  });

  it("昨年度が協会員でなければ、受付期間中でも not_member", () => {
    expect(decideMembershipDisplay(facts({ previous: "declined" }), duringPeriod)).toBe("not_member");
    expect(decideMembershipDisplay(facts(), duringPeriod)).toBe("not_member");
  });

  it("更新しない（declined）と答えた人は not_member", () => {
    expect(decideMembershipDisplay(facts({ current: "declined", previous: "approved" }), duringPeriod)).toBe("not_member");
  });
});

describe("画面と CSV の文言", () => {
  it("画面の文言は §4.4 の対応表どおり。no_data は出さない", () => {
    expect(membershipDisplayText("member", 2026)).toBe("協会員（2026年度）");
    expect(membershipDisplayText("pending", 2027)).toBe("運営の確認待ち");
    expect(membershipDisplayText("renewal_pending", 2027)).toBe("更新の受付中（昨年度は協会員）");
    expect(membershipDisplayText("not_member", 2027)).toBe("協会員ではない");
    expect(membershipDisplayText("no_data", 2027)).toBeNull();
  });

  it("CSV はデータのない年度だけ空欄", () => {
    expect(membershipCsvText("member")).toBe("協会員");
    expect(membershipCsvText("not_member")).toBe("非会員");
    expect(membershipCsvText("no_data")).toBe("");
  });
});

describe("受付の状態（renewalState）", () => {
  const period = {
    id: "x",
    year: 2027,
    opensAt: new Date("2027-03-31T15:00:00Z"), // 日本時間 4/1 0:00
    closesAt: new Date("2027-06-30T14:59:59.999Z"), // 日本時間 6/30 23:59:59.999
    autoApprove: false,
  };

  it("受付がなければ null", () => {
    expect(renewalState(null, new Date())).toBeNull();
  });

  it("開始前・期間中・締切後を分ける（境界を含む）", () => {
    expect(renewalState(period, new Date("2027-03-31T14:59:59Z"))).toBe("not_started");
    expect(renewalState(period, period.opensAt)).toBe("open");
    expect(renewalState(period, period.closesAt)).toBe("open");
    expect(renewalState(period, new Date(period.closesAt.getTime() + 1))).toBe("closed");
  });
});
