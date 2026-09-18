import { describe, expect, it } from "vitest";
import { parseTeamInput } from "@/lib/teams/team-input";

// チーム情報の入力（§5.11「チームの作り方」）。チーム名だけで作れる
describe("parseTeamInput", () => {
  it("チーム名だけで通る。ほかは空、協会員の登録をするチームは既定で外れている", () => {
    expect(parseTeamInput({ name: "  早良ビーチ  " })).toEqual({
      ok: true,
      value: { name: "早良ビーチ", kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false },
    });
  });

  it("チーム名は必須・50 文字まで", () => {
    expect(parseTeamInput({ name: "　" })).toMatchObject({ ok: false, field: "name" });
    expect(parseTeamInput({ name: "あ".repeat(50) }).ok).toBe(true);
    expect(parseTeamInput({ name: "あ".repeat(51) })).toMatchObject({ ok: false, field: "name" });
  });

  it("全角の英数字は半角にそろえる（NFKC）", () => {
    expect(parseTeamInput({ name: "ＡＢＣ　クラブ" })).toMatchObject({ ok: true, value: { name: "ABC クラブ" } });
  });

  it("ふりがなはひらがな・カタカナ", () => {
    expect(parseTeamInput({ name: "A", kana: "えーびーしー くらぶ" })).toMatchObject({
      ok: true,
      value: { kana: "えーびーしー くらぶ" },
    });
    expect(parseTeamInput({ name: "A", kana: "ABC" })).toMatchObject({ ok: false, field: "kana" });
  });

  it("連絡先のメール・電話は形を確かめる", () => {
    expect(parseTeamInput({ name: "A", contactEmail: "Taro@Example.com" })).toMatchObject({
      value: { contactEmail: "taro@example.com" },
    });
    expect(parseTeamInput({ name: "A", contactEmail: "taro" })).toMatchObject({ ok: false, field: "contactEmail" });
    expect(parseTeamInput({ name: "A", contactPhone: "０９０－１２３４－５６７８" })).toMatchObject({
      value: { contactPhone: "090-1234-5678" },
    });
    expect(parseTeamInput({ name: "A", contactPhone: "1234" })).toMatchObject({ ok: false, field: "contactPhone" });
  });

  it("協会員の登録をするチームは true のときだけ", () => {
    expect(parseTeamInput({ name: "A", membershipRenewalTarget: true })).toMatchObject({
      value: { membershipRenewalTarget: true },
    });
    expect(parseTeamInput({ name: "A", membershipRenewalTarget: "true" })).toMatchObject({
      value: { membershipRenewalTarget: false },
    });
  });
});
