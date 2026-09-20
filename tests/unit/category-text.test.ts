import { describe, expect, it } from "vitest";
import { applyMixedNotation, isMixedNotation } from "@/lib/presets/notation";
import { ageConditionText, categoryConditionText, genderConditionText } from "@/lib/tournaments/category-text";

const reference = { year: 2026, month: 9, day: 30 };

describe("混合 / MIX の表記（§5.4）", () => {
  it("混合の部だけ書き換わり、code に使う値は変わらない", () => {
    expect(applyMixedNotation("混合160オーバーの部", "mixed", "mix")).toBe("MIX160オーバーの部");
    expect(applyMixedNotation("MIX160オーバーの部", "mixed", "kanji")).toBe("混合160オーバーの部");
    expect(applyMixedNotation("男子40歳以上の部", "male", "mix")).toBe("男子40歳以上の部");
  });

  it("知らない表記は受け取らない", () => {
    expect(isMixedNotation("mix")).toBe(true);
    expect(isMixedNotation("ミックス")).toBe(false);
  });
});

describe("部の条件の文章（§5.6）", () => {
  const mixed = { gender: "mixed", ruleType: "total_age", ruleValue: 160, courtSize: 4, mixedMinMale: 1, mixedMinFemale: 2 } as const;
  const male40 = { gender: "male", ruleType: "min_age", ruleValue: 40, courtSize: 4, mixedMinMale: 1, mixedMinFemale: 2 } as const;
  const free = { gender: "female", ruleType: "free", ruleValue: null, courtSize: 4, mixedMinMale: 1, mixedMinFemale: 2 } as const;

  it("男女の条件は混合だけ人数を出す", () => {
    expect(genderConditionText(male40)).toBe("男性だけで出場します");
    expect(genderConditionText(mixed)).toBe("コートに出る4人のうち、男性1人以上・女性2人以上です");
  });

  it("年齢の条件には基準日が入る。合計年齢は運営が確認すると書く", () => {
    expect(ageConditionText(male40, reference)).toBe("出場する全員が40歳以上です（2026年9月30日（水）時点）");
    expect(ageConditionText(mixed, reference)).toContain("合計年齢が160歳以上");
    expect(ageConditionText(mixed, reference)).toContain("運営が確認します");
    expect(ageConditionText(free, reference)).toBe("年齢の制限はありません");
  });

  it("2 つを並べた文章になる", () => {
    expect(categoryConditionText(free, reference)).toBe("女性だけで出場します。年齢の制限はありません。");
  });
});
