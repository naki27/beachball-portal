import { describe, expect, it } from "vitest";
import { parsePresetInput } from "@/lib/presets/preset-input";

// 「よく使う部」（部門プリセット）の入力（設計書 §5.4「部門（カテゴリ）の設計」）
const input = (over: Record<string, unknown> = {}) => ({
  code: "m_40",
  labelDefault: "男子40歳以上の部",
  gender: "male",
  ruleType: "min_age",
  ruleValue: "40",
  courtSize: "4",
  mixedMinMale: "1",
  mixedMinFemale: "2",
  sortOrder: "13",
  isActive: true,
  ...over,
});

describe("parsePresetInput", () => {
  it("そろった入力は通り、記号は小文字になる", () => {
    const result = parsePresetInput(input({ code: "M_40" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.code).toBe("m_40");
      expect(result.value.ruleValue).toBe(40);
      expect(result.value.isActive).toBe(true);
    }
  });

  it("記号は半角の英小文字・数字・_ だけ", () => {
    expect(parsePresetInput(input({ code: "男子40" }))).toMatchObject({ ok: false, field: "code" });
    expect(parsePresetInput(input({ code: "m-40" }))).toMatchObject({ ok: false, field: "code" });
    expect(parsePresetInput(input({ code: "" }))).toMatchObject({ ok: false, field: "code" });
  });

  it("年齢の制限なしのときだけ年齢の数が空欄（DB の CHECK と同じ規則）", () => {
    expect(parsePresetInput(input({ ruleType: "free", ruleValue: "40" }))).toMatchObject({ ok: false, field: "ruleValue" });
    expect(parsePresetInput(input({ ruleType: "min_age", ruleValue: "" }))).toMatchObject({ ok: false, field: "ruleValue" });
    const free = parsePresetInput(input({ ruleType: "free", ruleValue: "" }));
    expect(free.ok).toBe(true);
    if (free.ok) expect(free.value.ruleValue).toBeNull();
  });

  it("合計年齢は大きい数でも通るが、◯歳以上は 120 まで", () => {
    expect(parsePresetInput(input({ ruleType: "total_age", ruleValue: "200" })).ok).toBe(true);
    expect(parsePresetInput(input({ ruleType: "min_age", ruleValue: "200" }))).toMatchObject({ ok: false, field: "ruleValue" });
  });

  it("混合は男女の最少人数の合計がコートの人数以内", () => {
    expect(
      parsePresetInput(input({ gender: "mixed", ruleType: "free", ruleValue: "", courtSize: "4", mixedMinMale: "3", mixedMinFemale: "2" })),
    ).toMatchObject({ ok: false, field: "mixedMinFemale" });
    expect(
      parsePresetInput(input({ gender: "mixed", ruleType: "free", ruleValue: "", courtSize: "4", mixedMinMale: "1", mixedMinFemale: "2" })).ok,
    ).toBe(true);
    // 男子・女子の部では合計を見ない（プリセットの既定値のまま残っていてよい）
    expect(parsePresetInput(input({ gender: "male", mixedMinMale: "3", mixedMinFemale: "3" })).ok).toBe(true);
  });

  it("コートの人数・並び順は数のみ", () => {
    expect(parsePresetInput(input({ courtSize: "0" }))).toMatchObject({ ok: false, field: "courtSize" });
    expect(parsePresetInput(input({ sortOrder: "-1" }))).toMatchObject({ ok: false, field: "sortOrder" });
  });
});
