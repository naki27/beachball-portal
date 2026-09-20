import { describe, expect, it } from "vitest";
import { endOfDayTokyo, startOfDayTokyo, type PlainDate } from "@/lib/date";
import {
  daysUntilDeadline,
  effectiveAgeReferenceDate,
  effectiveDeadline,
  entryState,
  isEntryOpen,
  tournamentEntryState,
  type CategoryDeadline,
  type TournamentDeadline,
} from "@/lib/deadline";

const d = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

// 締切日 2026-09-30（日付で入力 → 日本時間 23:59:59.999 で保存・§5.4）
const END = endOfDayTokyo(d(2026, 9, 30));
const START = startOfDayTokyo(d(2026, 9, 1));

const tournament = (over: Partial<TournamentDeadline> = {}): TournamentDeadline => ({
  status: "open",
  entryStartAt: START,
  entryEndAt: END,
  ...over,
});
const category = (over: Partial<CategoryDeadline> = {}): CategoryDeadline => ({ entryEndAt: null, ...over });

// 有効な締切・基準日と受付の可否（付録 D・§5.4）。Date の比較なので TZ=UTC でも同じ結果になること
describe("effectiveDeadline / effectiveAgeReferenceDate（部門 → 大会のフォールバック）", () => {
  it("部門の締切があればそれ、なければ大会の締切", () => {
    const later = endOfDayTokyo(d(2026, 10, 15));
    expect(effectiveDeadline(category(), { entryEndAt: END })).toEqual(END);
    expect(effectiveDeadline(category({ entryEndAt: later }), { entryEndAt: END })).toEqual(later);
    // 大会より前に縮めることもできる（一部の部門だけ早く締める）
    const earlier = endOfDayTokyo(d(2026, 9, 10));
    expect(effectiveDeadline(category({ entryEndAt: earlier }), { entryEndAt: END })).toEqual(earlier);
  });

  it("部門の基準日があればそれ、なければ大会の基準日", () => {
    expect(effectiveAgeReferenceDate({ ageReferenceDate: null }, { ageReferenceDate: d(2026, 11, 1) })).toEqual(
      d(2026, 11, 1),
    );
    expect(
      effectiveAgeReferenceDate({ ageReferenceDate: d(2027, 4, 1) }, { ageReferenceDate: d(2026, 11, 1) }),
    ).toEqual(d(2027, 4, 1));
  });
});

describe("entryState / isEntryOpen（§5.4 の表）", () => {
  it("締切日 9/30 は日本時間 23:59:59 まで受付、10/1 0:00 は締切後", () => {
    const lastMoment = new Date("2026-09-30T14:59:59+00:00"); // 日本時間 9/30 23:59:59
    const nextDay = new Date("2026-09-30T15:00:00+00:00"); // 日本時間 10/1 0:00
    expect(entryState(tournament(), category(), lastMoment)).toBe("open");
    expect(entryState(tournament(), category(), nextDay)).toBe("closed");
    // ちょうど締切の瞬間（23:59:59.999）も受付
    expect(entryState(tournament(), category(), END)).toBe("open");
    expect(entryState(tournament(), category(), new Date(END.getTime() + 1))).toBe("closed");
  });

  it("申込開始の前は not_started。開始日の 0:00 ちょうどから受付", () => {
    const before = new Date("2026-08-31T14:59:59+00:00"); // 日本時間 8/31 23:59:59
    expect(entryState(tournament(), category(), before)).toBe("not_started");
    expect(entryState(tournament(), category(), START)).toBe("open");
    // 開始日が未設定なら締切まではいつでも受付
    expect(entryState(tournament({ entryStartAt: null }), category(), before)).toBe("open");
  });

  it("closed は期間内でも不可、draft と archived は unavailable", () => {
    const inPeriod = new Date("2026-09-15T00:00:00Z");
    expect(entryState(tournament({ status: "closed" }), category(), inPeriod)).toBe("closed");
    expect(entryState(tournament({ status: "draft" }), category(), inPeriod)).toBe("unavailable");
    expect(entryState(tournament({ status: "archived" }), category(), inPeriod)).toBe("unavailable");
    // draft・archived は期間外でも unavailable（理由の出し分けを取り違えない）
    const after = new Date("2026-12-01T00:00:00Z");
    expect(entryState(tournament({ status: "draft" }), category(), after)).toBe("unavailable");
    expect(entryState(tournament({ status: "archived" }), category(), after)).toBe("unavailable");
  });

  it("部門ごとに判定する（同じ大会でも締切の違う部門は別の結果）", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    const extended = category({ entryEndAt: endOfDayTokyo(d(2026, 10, 15)) });
    expect(entryState(tournament(), category(), now)).toBe("closed"); // 大会の締切どおりの部門
    expect(entryState(tournament(), extended, now)).toBe("open"); // 延長した部門
    // 手で締め切ったときは、延長した部門も止まる
    expect(entryState(tournament({ status: "closed" }), extended, now)).toBe("closed");
  });

  it("isEntryOpen は open のときだけ true", () => {
    const inPeriod = new Date("2026-09-15T00:00:00Z");
    expect(isEntryOpen(tournament(), category(), inPeriod)).toBe(true);
    for (const state of [
      tournament({ status: "closed" }),
      tournament({ status: "draft" }),
      tournament({ status: "archived" }),
      tournament({ entryStartAt: startOfDayTokyo(d(2026, 12, 1)) }),
    ]) {
      expect(isEntryOpen(state, category(), inPeriod)).toBe(false);
    }
    expect(isEntryOpen(tournament(), category(), new Date("2026-12-01T00:00:00Z"))).toBe(false);
  });
});

describe("tournamentEntryState（大会をまとめて見る・§5.6）", () => {
  const open = () => ({ entryEndAt: endOfDayTokyo(d(2026, 10, 15)) });
  const past = () => ({ entryEndAt: endOfDayTokyo(d(2026, 9, 1)) });
  const now = new Date("2026-10-05T00:00:00Z");

  it("1 つでも受け付けている部があれば受付中", () => {
    expect(tournamentEntryState(tournament(), [past(), open()], now)).toBe("open");
    expect(tournamentEntryState(tournament(), [past(), past()], now)).toBe("closed");
  });

  it("部がない大会は、大会の締切だけで決める", () => {
    expect(tournamentEntryState(tournament(), [], new Date("2026-09-15T00:00:00Z"))).toBe("open");
    expect(tournamentEntryState(tournament(), [], now)).toBe("closed");
  });

  it("どの部もまだ始まっていなければ「これから」、準備中・終了は「受け付けない」", () => {
    const notStarted = tournament({ entryStartAt: startOfDayTokyo(d(2026, 12, 1)) });
    expect(tournamentEntryState(notStarted, [open(), past()], now)).toBe("not_started");
    expect(tournamentEntryState(tournament({ status: "draft" }), [open()], now)).toBe("unavailable");
    expect(tournamentEntryState(tournament({ status: "archived" }), [open()], now)).toBe("unavailable");
  });
});

describe("daysUntilDeadline（「あと5日」・§5.6）", () => {
  it("日本時間の暦で数える。当日は 0、過ぎていれば負", () => {
    const deadline = endOfDayTokyo(d(2026, 9, 30));
    // 日本時間の 9 月 25 日（UTC では 9 月 24 日 15:00 以降）
    expect(daysUntilDeadline(deadline, new Date("2026-09-24T15:00:00Z"))).toBe(5);
    expect(daysUntilDeadline(deadline, new Date("2026-09-30T00:00:00Z"))).toBe(0);
    // 締切の瞬間（日本時間 9/30 23:59:59）はまだ当日
    expect(daysUntilDeadline(deadline, deadline)).toBe(0);
    // その 1 ミリ秒後は 10/1 なので過ぎている
    expect(daysUntilDeadline(deadline, new Date(deadline.getTime() + 1))).toBe(-1);
  });
});
