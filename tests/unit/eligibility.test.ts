import { describe, expect, it } from "vitest";
import type { PlainDate } from "@/lib/date";
import {
  hasEligibilityError,
  validateEligibility,
  type EligibilityPlayer,
  type EligibilityPreset,
} from "@/lib/eligibility";

const d = (year: number, month: number, day: number): PlainDate => ({ year, month, day });

// 基準日は 2026-11-01（大会の設定値。deadline.ts の effectiveAgeReferenceDate で決める）
const REF = d(2026, 11, 1);

// 男子40歳以上の部・混合160オーバーの部などの設定値（category_presets の既定）
const preset = (over: Partial<EligibilityPreset> = {}): EligibilityPreset => ({
  gender: "male",
  ruleType: "free",
  ruleValue: null,
  courtSize: 4,
  mixedMinMale: 1,
  mixedMinFemale: 2,
  ...over,
});

// 基準日に age 歳になる人（誕生日は基準日と同じ月日 = 当日に加齢して age 歳）
const player = (name: string, age: number, sex: "male" | "female" = "male"): EligibilityPlayer => ({
  name,
  birthDate: d(REF.year - age, REF.month, REF.day),
  sex,
});

const messages = (players: EligibilityPlayer[], p: EligibilityPreset) =>
  validateEligibility(players, p, REF).issues.map((i) => i.message);

// 部門の資格バリデーション（§5.5(e) の受け入れ条件・付録 E）
describe("性別", () => {
  it("男子の部に女性がいるとエラーになり、その選手を名指しする", () => {
    const players = [player("早良太郎", 45), player("早良花子", 45, "female"), player("早良次郎", 45)];
    const result = validateEligibility(players, preset({ gender: "male" }), REF);
    expect(result.issues).toEqual([
      { level: "error", message: "早良花子さんはこの部（男子）の対象ではありません", playerIndex: 1 },
    ]);
    expect(hasEligibilityError(result)).toBe(true);
  });

  it("女子の部に男性がいるとエラー。全員が対象なら通る", () => {
    const women = [player("早良花子", 30, "female"), player("早良桃子", 30, "female")];
    expect(messages(women, preset({ gender: "female" }))).toEqual([]);
    expect(messages([...women, player("早良太郎", 30)], preset({ gender: "female" }))).toEqual([
      "早良太郎さんはこの部（女子）の対象ではありません",
    ]);
  });
});

describe("混合の男女比（コート 4 名で 男 1 以上・女 2 以上）", () => {
  const mixed = preset({ gender: "mixed" });
  const team = (males: number, females: number): EligibilityPlayer[] => [
    ...Array.from({ length: males }, (_, i) => player(`男${i + 1}`, 30, "male")),
    ...Array.from({ length: females }, (_, i) => player(`女${i + 1}`, 30, "female")),
  ];

  it("男 3・女 1 はエラー（編成が組めない）", () => {
    expect(messages(team(3, 1), mixed)).toEqual(["混合の部は女子2名以上の登録が必要です（現在1名）"]);
  });

  it("男 1・女 3 と 男 2・女 2 は成功する", () => {
    expect(messages(team(1, 3), mixed)).toEqual([]);
    expect(messages(team(2, 2), mixed)).toEqual([]);
  });

  it("男子 0 名はエラー。男子が 3 名以上いても女子が足りていれば通る", () => {
    expect(messages(team(0, 4), mixed)).toEqual(["混合の部は男子1名以上の登録が必要です（現在0名）"]);
    expect(messages(team(4, 2), mixed)).toEqual([]);
    // 両方足りなければ 2 件
    expect(messages(team(0, 1), mixed)).toHaveLength(2);
  });

  it("mixed_min_female を 1 にすると 男 3・女 1 が通る（設定値で挙動が変わる）", () => {
    expect(messages(team(3, 1), preset({ gender: "mixed", mixedMinFemale: 1 }))).toEqual([]);
  });
});

describe("年齢の下限（◯◯歳以上の部）", () => {
  const over40 = preset({ ruleType: "min_age", ruleValue: 40 });

  it("40 歳以上の部に 39 歳がいると、その選手名と年齢を出してエラー", () => {
    const players = [player("早良太郎", 45), player("早良次郎", 39)];
    const result = validateEligibility(players, over40, REF);
    expect(result.issues).toEqual([
      { level: "error", message: "この部は40歳以上が対象です（早良次郎さんは39歳）", playerIndex: 1 },
    ]);
  });

  it("基準日が誕生日の当日なら対象、前日ならまだ 39 歳でエラー（境界）", () => {
    const onBirthday: EligibilityPlayer = { name: "早良太郎", birthDate: d(1986, 11, 1), sex: "male" };
    const dayAfterBirthday: EligibilityPlayer = { name: "早良次郎", birthDate: d(1986, 11, 2), sex: "male" };
    expect(messages([onBirthday], over40)).toEqual([]);
    expect(messages([dayAfterBirthday], over40)).toEqual(["この部は40歳以上が対象です（早良次郎さんは39歳）"]);
  });

  it("2 月 29 日生まれは、基準日が平年の 2 月 28 日ならまだ加齢せず、3 月 1 日で加齢する", () => {
    const leap: EligibilityPlayer = { name: "早良花子", birthDate: d(1986, 2, 29), sex: "male" };
    expect(validateEligibility([leap], over40, d(2026, 2, 28)).issues).toEqual([
      { level: "error", message: "この部は40歳以上が対象です（早良花子さんは39歳）", playerIndex: 0 },
    ]);
    expect(validateEligibility([leap], over40, d(2026, 3, 1)).issues).toEqual([]);
  });

  it("フリーの部は年齢を見ない", () => {
    expect(messages([player("早良太郎", 18), player("早良次郎", 70)], preset())).toEqual([]);
  });
});

describe("合計年齢の部（判定せず、数字を見せるだけ・§14-20）", () => {
  const over160 = preset({ gender: "mixed", ruleType: "total_age", ruleValue: 160 });

  it("基準に届かなくても送信でき、needsAdminCheck が立つ", () => {
    // 30 歳 4 人（合計 120 歳）でも error にはしない
    const players = [
      player("男1", 30, "male"),
      player("女1", 30, "female"),
      player("女2", 30, "female"),
      player("女3", 30, "female"),
    ];
    const result = validateEligibility(players, over160, REF);
    expect(result.needsAdminCheck).toBe(true);
    expect(hasEligibilityError(result)).toBe(false);
    expect(result.issues.map((i) => i.level)).toEqual(["warning"]);
    expect(result.infos).toEqual([
      { label: "合計年齢", value: "120歳〜120歳（出場する4人によって変わります。運営が確認します）" },
      { label: "この部の基準", value: "160歳以上" },
    ]);
  });

  it("登録が 5 人以上なら、低い順 4 名の合計〜高い順 4 名の合計を出す", () => {
    const players = [
      player("男1", 30, "male"),
      player("女1", 40, "female"),
      player("女2", 45, "female"),
      player("女3", 50, "female"),
      player("女4", 60, "female"),
    ];
    const result = validateEligibility(players, over160, REF);
    // 低い順 4 名: 30+40+45+50 = 165、高い順 4 名: 40+45+50+60 = 195
    expect(result.infos[0].value).toBe("165歳〜195歳（出場する4人によって変わります。運営が確認します）");
    // 下限が基準を超えているので注意文は出ない
    expect(result.issues).toEqual([]);
  });

  it("組み合わせによって届かないときだけ注意文を出す（送信は止めない）", () => {
    const players = [
      player("男1", 30, "male"),
      player("女1", 30, "female"),
      player("女2", 50, "female"),
      player("女3", 60, "female"),
      player("女4", 70, "female"),
    ];
    // 低い順 4 名: 30+30+50+60 = 170、高い順 4 名: 30+50+60+70 = 210（基準 160 歳はどちらでも超える）
    const result = validateEligibility(players, over160, REF);
    expect(result.issues).toEqual([]);

    // 基準を 200 歳にすると、低い順の 4 人では届かない
    const strict = validateEligibility(players, { ...over160, ruleValue: 200 }, REF);
    expect(strict.issues).toEqual([
      { level: "warning", message: "出場する4人によっては合計年齢が200歳に届きません（170歳〜210歳）" },
    ]);
    expect(hasEligibilityError(strict)).toBe(false);
  });

  it("混合の男女比は合計年齢の部でも見る（性別のエラーとは別に数字は出す）", () => {
    const players = [player("男1", 50), player("男2", 50), player("男3", 50), player("女1", 50, "female")];
    const result = validateEligibility(players, over160, REF);
    expect(result.issues).toEqual([{ level: "error", message: "混合の部は女子2名以上の登録が必要です（現在1名）" }]);
    expect(result.infos[0].value).toBe("200歳〜200歳（出場する4人によって変わります。運営が確認します）");
  });

  it("コート上の人数が設定値から読まれる（court_size = 6 なら 6 人の合計）", () => {
    const players = Array.from({ length: 6 }, (_, i) => player(`女${i + 1}`, 30, "female"));
    players.push(player("男1", 30, "male"));
    const result = validateEligibility(players, { ...over160, courtSize: 6, ruleValue: 180 }, REF);
    expect(result.infos[0].value).toBe("180歳〜180歳（出場する6人によって変わります。運営が確認します）");
  });
});
