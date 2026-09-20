import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL_MAX, parseCategoryInput } from "@/lib/tournaments/category-input";

// 大会の部の入力（設計書 §5.4）。締切・基準日の空欄は「大会の値に従う」の意味
const input = (over: Record<string, unknown> = {}) => ({
  label: "男子40歳以上の部",
  entryEndDate: "",
  ageReferenceDate: "",
  maxEntries: "",
  ...over,
});

describe("parseCategoryInput", () => {
  it("空欄の締切・基準日・上限は null（大会の値に従う）", () => {
    const result = parseCategoryInput(input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.label).toBe("男子40歳以上の部");
      expect(result.value.entryEndDate).toBeNull();
      expect(result.value.ageReferenceDate).toBeNull();
      expect(result.value.maxEntries).toBeNull();
    }
  });

  it("締切・基準日は年月日で読み、区切りが / や . でも通る", () => {
    const result = parseCategoryInput(input({ entryEndDate: "2026/09/30", ageReferenceDate: "2026.11.23", maxEntries: "12" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entryEndDate).toEqual({ year: 2026, month: 9, day: 30 });
      expect(result.value.ageReferenceDate).toEqual({ year: 2026, month: 11, day: 23 });
      expect(result.value.maxEntries).toBe(12);
    }
  });

  it("名前は必須で、長すぎると欄の名前つきの誤り", () => {
    const empty = parseCategoryInput(input({ label: "   " }));
    expect(empty).toMatchObject({ ok: false, field: "label" });
    const long = parseCategoryInput(input({ label: "あ".repeat(CATEGORY_LABEL_MAX + 1) }));
    expect(long).toMatchObject({ ok: false, field: "label" });
  });

  it("存在しない日付・数でない上限・0 以下の上限は誤り", () => {
    expect(parseCategoryInput(input({ entryEndDate: "2026-02-30" }))).toMatchObject({ ok: false, field: "entryEndDate" });
    expect(parseCategoryInput(input({ ageReferenceDate: "きのう" }))).toMatchObject({ ok: false, field: "ageReferenceDate" });
    expect(parseCategoryInput(input({ maxEntries: "たくさん" }))).toMatchObject({ ok: false, field: "maxEntries" });
    expect(parseCategoryInput(input({ maxEntries: "0" }))).toMatchObject({ ok: false, field: "maxEntries" });
  });
});
