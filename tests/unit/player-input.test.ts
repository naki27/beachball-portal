import { describe, expect, it } from "vitest";
import { parsePlayerInput } from "@/lib/teams/player-input";

// 選手の項目（§5.11 = §5.5 の選手項目）。生年月日は "YYYY-MM-DD" で来る（和暦の入力は部品が受け持つ）
const TODAY = { year: 2026, month: 9, day: 18 };
const ok = { name: "山田 太郎", kana: "やまだ たろう", birthDate: "1965-05-03", sex: "male" };

describe("parsePlayerInput", () => {
  it("氏名・生年月日・性別は必須。ふりがなは任意", () => {
    expect(parsePlayerInput(ok, TODAY)).toEqual({
      ok: true,
      value: { name: "山田 太郎", kana: "やまだ たろう", birthDate: "1965-05-03", sex: "male" },
    });
    expect(parsePlayerInput({ ...ok, kana: "" }, TODAY)).toMatchObject({ ok: true, value: { kana: null } });
    expect(parsePlayerInput({ ...ok, name: " " }, TODAY)).toMatchObject({ ok: false, field: "name" });
    expect(parsePlayerInput({ ...ok, birthDate: undefined }, TODAY)).toMatchObject({ ok: false, field: "birthDate" });
    expect(parsePlayerInput({ ...ok, sex: "" }, TODAY)).toMatchObject({ ok: false, field: "sex" });
    expect(parsePlayerInput({ ...ok, sex: "other" }, TODAY)).toMatchObject({ ok: false, field: "sex" });
  });

  it("生年月日は存在する日付で、1900 年から今日まで", () => {
    expect(parsePlayerInput({ ...ok, birthDate: "2026-02-30" }, TODAY)).toMatchObject({ ok: false, field: "birthDate" });
    expect(parsePlayerInput({ ...ok, birthDate: "1899-12-31" }, TODAY)).toMatchObject({ ok: false, field: "birthDate" });
    expect(parsePlayerInput({ ...ok, birthDate: "2026-09-19" }, TODAY)).toMatchObject({ ok: false, field: "birthDate" });
    expect(parsePlayerInput({ ...ok, birthDate: "2026-09-18" }, TODAY)).toMatchObject({ ok: true });
  });

  it("ふりがなはひらがな・カタカナだけ。全角の英数字は半角にそろえる", () => {
    expect(parsePlayerInput({ ...ok, kana: "yamada" }, TODAY)).toMatchObject({ ok: false, field: "kana" });
    expect(parsePlayerInput({ ...ok, name: "Ｊｏｈｎ　Ｓｍｉｔｈ" }, TODAY)).toMatchObject({ value: { name: "John Smith" } });
  });
});
