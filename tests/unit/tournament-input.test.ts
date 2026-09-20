import { describe, expect, it } from "vitest";
import { parseTournamentInput, TOURNAMENT_NAME_MAX } from "@/lib/tournaments/tournament-input";

// 大会の入力の検査（設計書 §5.4「設定値の整合性」のうち 1 つの表で完結する分）
const base = {
  name: "第1回 早良区大会",
  eventDate: "2026-11-23",
  ageReferenceDate: "",
  venue: "早良体育館",
  description: "参加費 1チーム 3000円",
  entryStartDate: "2026-09-01",
  entryEndDate: "2026-09-30",
  teamSizeMin: "4",
  teamSizeMax: "7",
  maxEntries: "",
  status: "draft",
};

const parse = (over: Record<string, unknown> = {}) => parseTournamentInput({ ...base, ...over });
const error = (over: Record<string, unknown>) => {
  const result = parse(over);
  if (result.ok) throw new Error("エラーになるはずの入力が通りました");
  return { field: result.field, message: result.message };
};

describe("parseTournamentInput", () => {
  it("正しい入力を読み、空欄は null になる", () => {
    const result = parse({ venue: "", description: "", entryStartDate: "", maxEntries: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: "第1回 早良区大会",
      eventDate: { year: 2026, month: 11, day: 23 },
      // 年齢の基準日が空なら開催日（§14-21）
      ageReferenceDate: { year: 2026, month: 11, day: 23 },
      venue: null,
      description: null,
      entryStartDate: null,
      entryEndDate: { year: 2026, month: 9, day: 30 },
      teamSizeMin: 4,
      teamSizeMax: 7,
      maxEntries: null,
      status: "draft",
    });
  });

  it("年齢の基準日を入れれば開催日と別にできる。どちらも空なら入力を求める", () => {
    const result = parse({ ageReferenceDate: "2027-04-01" });
    expect(result.ok && result.value.ageReferenceDate).toEqual({ year: 2027, month: 4, day: 1 });
    expect(error({ eventDate: "", ageReferenceDate: "" }).field).toBe("ageReferenceDate");
  });

  it("大会名と締切日は必須", () => {
    expect(error({ name: "  " })).toEqual({ field: "name", message: "大会名を入力してください" });
    expect(error({ name: "あ".repeat(TOURNAMENT_NAME_MAX + 1) }).field).toBe("name");
    expect(error({ entryEndDate: "" })).toEqual({ field: "entryEndDate", message: "締切日を入力してください" });
  });

  it("日付の形・存在しない日付を弾く", () => {
    expect(error({ entryEndDate: "2026-09-31" }).field).toBe("entryEndDate");
    expect(error({ eventDate: "2026/13/01" }).field).toBe("eventDate");
    // 全角と区切りの違いは受け取る（NFKC と / . の読み替え）
    expect(parse({ eventDate: "２０２６/１１/２３" }).ok).toBe(true);
  });

  it("締切日は申し込みの開始日以降。同じ日は通る（0:00〜23:59:59）", () => {
    expect(error({ entryStartDate: "2026-10-01", entryEndDate: "2026-09-30" }).field).toBe("entryEndDate");
    expect(parse({ entryStartDate: "2026-09-30", entryEndDate: "2026-09-30" }).ok).toBe(true);
  });

  it("参加人数は 下限 ≦ 上限、1 人以上", () => {
    expect(error({ teamSizeMin: "8", teamSizeMax: "7" })).toEqual({
      field: "teamSizeMax",
      message: "参加人数の上限は下限以上にしてください",
    });
    expect(error({ teamSizeMin: "0" }).field).toBe("teamSizeMin");
    expect(error({ teamSizeMin: "" }).field).toBe("teamSizeMin");
    expect(error({ teamSizeMax: "四" }).field).toBe("teamSizeMax");
    expect(parse({ teamSizeMin: "4", teamSizeMax: "4" }).ok).toBe(true);
  });

  it("申し込みの上限は空欄なら上限なし、入れるなら 1 以上", () => {
    expect(parse({ maxEntries: "10" }).ok).toBe(true);
    expect(error({ maxEntries: "0" }).field).toBe("maxEntries");
    expect(error({ maxEntries: "-1" }).field).toBe("maxEntries");
  });

  it("公開の状態は 4 つだけ。空欄なら準備中", () => {
    for (const status of ["draft", "open", "closed", "archived"]) {
      expect(parse({ status }).ok).toBe(true);
    }
    expect(error({ status: "published" }).field).toBe("status");
    const blank = parse({ status: "" });
    expect(blank.ok && blank.value.status).toBe("draft");
  });
});
