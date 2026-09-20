import { describe, expect, it } from "vitest";
import { ENTRY_NOTE_MAX, parseEntryInput } from "@/lib/entries/entry-input";
import { TEAM_NAME_MAX } from "@/lib/teams/team-input";

// 大会申込の入力（設計書 §5.5「入力ページ」）。選手枠は B-09
const TEAM = "11111111-1111-4111-8111-111111111111";
const CATEGORY = "22222222-2222-4222-8222-222222222222";

const input = (over: Record<string, unknown> = {}) => ({
  teamId: TEAM,
  newTeamName: "",
  teamName: "早良さくら",
  categoryId: CATEGORY,
  note: "",
  token: "33333333-3333-4333-8333-333333333333",
  ...over,
});

describe("parseEntryInput", () => {
  it("チームを選んだ申し込みは通る", () => {
    const result = parseEntryInput(input({ note: "駐車場を使います" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.teamId).toBe(TEAM);
      expect(result.value.newTeamName).toBeNull();
      expect(result.value.teamName).toBe("早良さくら");
      expect(result.value.note).toBe("駐車場を使います");
    }
  });

  it("チームがないときは、その場で作る名前が要る（別のページに飛ばさない）", () => {
    expect(parseEntryInput(input({ teamId: "", newTeamName: "", teamName: "" }))).toMatchObject({ ok: false, field: "newTeamName" });
    const created = parseEntryInput(input({ teamId: "", newTeamName: "即席チーム", teamName: "" }));
    expect(created.ok).toBe(true);
    // 公開されるチーム名が空なら、その場で作る名前を使う
    if (created.ok) {
      expect(created.value.teamId).toBeNull();
      expect(created.value.newTeamName).toBe("即席チーム");
      expect(created.value.teamName).toBe("即席チーム");
    }
  });

  it("公開されるチーム名は、登録のチーム名と別に変えられる", () => {
    const result = parseEntryInput(input({ teamName: "早良さくらB" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.teamName).toBe("早良さくらB");
  });

  it("部は必ず選ぶ。ID の形が違えば選び直してもらう", () => {
    expect(parseEntryInput(input({ categoryId: "" }))).toMatchObject({ ok: false, field: "categoryId" });
    expect(parseEntryInput(input({ categoryId: "男子40" }))).toMatchObject({ ok: false, field: "categoryId" });
    expect(parseEntryInput(input({ teamId: "こわれた-id" }))).toMatchObject({ ok: false, field: "teamId" });
  });

  it("長すぎるチーム名・備考は誤り", () => {
    expect(parseEntryInput(input({ teamName: "あ".repeat(TEAM_NAME_MAX + 1) }))).toMatchObject({ ok: false, field: "teamName" });
    expect(parseEntryInput(input({ note: "あ".repeat(ENTRY_NOTE_MAX + 1) }))).toMatchObject({ ok: false, field: "note" });
  });

  it("送信用のワンタイムの値がなければ送らせない（二重送信を防ぐ・§5.5）", () => {
    expect(parseEntryInput(input({ token: "" }))).toMatchObject({ ok: false, field: "token" });
  });
});
