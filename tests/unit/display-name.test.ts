import { describe, expect, it } from "vitest";
import { DISPLAY_NAME_MAX, parseDisplayName } from "@/lib/account/display-name";

// 表示名（任意・§5.3・docs/adr/0007）
describe("parseDisplayName", () => {
  it("前後の空白を除き、続く空白（全角を含む）は 1 つにまとめる", () => {
    expect(parseDisplayName("  山田　 太郎 ")).toEqual({ ok: true, value: "山田 太郎" });
  });

  it("空・空白だけ・null は表示名なし", () => {
    expect(parseDisplayName("")).toEqual({ ok: true, value: null });
    expect(parseDisplayName("　 ")).toEqual({ ok: true, value: null });
    expect(parseDisplayName(null)).toEqual({ ok: true, value: null });
  });

  it(`${DISPLAY_NAME_MAX} 文字まで（絵文字などのサロゲートペアも 1 文字と数える）`, () => {
    expect(parseDisplayName("あ".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(parseDisplayName("😀".repeat(DISPLAY_NAME_MAX)).ok).toBe(true);
    expect(parseDisplayName("あ".repeat(DISPLAY_NAME_MAX + 1))).toEqual({ ok: false, message: "30文字以内で入力してください" });
  });

  it("文字列でない値・制御文字は受け付けない", () => {
    expect(parseDisplayName(123).ok).toBe(false);
    expect(parseDisplayName("a\u0000b").ok).toBe(false);
  });
});
