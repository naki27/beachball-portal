import { describe, expect, it } from "vitest";
import { normalizeName } from "@/lib/normalize";

// 設計書 §8.2 の例をすべて
describe("normalizeName（§8.2 の例）", () => {
  it.each([
    ["山田 太郎", "山田太郎"],
    ["山田　太郎（主将）", "山田太郎"],
    ["【代表】山田太郎", "山田太郎"],
    ["ﾔﾏﾀﾞ ﾀﾛｳ", "ヤマダタロウ"], // 半角カナ
    ["やまだ たろう", "ヤマダタロウ"],
    ["Yamada Taro", "yamadataro"],
    ["山田・太郎", "山田太郎"],
    ["髙橋", "髙橋"], // v1 は異体字を統一しない（§8.1）
    ["ｻﾄｳ-ﾀﾛｳ", "サトウタロウ"], // ハイフン入り
    ["佐藤（旧姓：鈴木）花子", "佐藤花子"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});

describe("normalizeName（補足）", () => {
  it("長音「ー」は残り、ほかの記号・タブ・LIKE の特殊文字は消える", () => {
    expect(normalizeName("サトウ\tタロー")).toBe("サトウタロー");
    expect(normalizeName("50%_off")).toBe("50off");
    expect(normalizeName("[主将]「太郎」『花子』<a>山田")).toBe("山田");
  });

  it("全角英数字は半角の小文字になる", () => {
    expect(normalizeName("ＡＢＣ１２３")).toBe("abc123");
  });

  it("空なら空", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("  　 ")).toBe("");
  });
});
