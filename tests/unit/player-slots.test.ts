import { describe, expect, it } from "vitest";
import {
  countBySex,
  emptySlot,
  initialSlots,
  isBlankSlot,
  parsePlayerSlots,
  type PlayerSlot,
  toEligibilityPlayers,
} from "@/lib/entries/player-slots";

// 申込の選手枠（設計書 §5.5「入力ページ」3）
const TODAY = { year: 2026, month: 9, day: 20 };
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const pick = (n: number, over: Partial<PlayerSlot> = {}): PlayerSlot => ({
  kind: "pick",
  memberId: ID(n),
  name: `選手${n}`,
  kana: null,
  birthDate: "1980-04-01",
  sex: "male",
  ...over,
});

const manual = (over: Partial<PlayerSlot> = {}): PlayerSlot => ({
  kind: "manual",
  memberId: null,
  name: "山田 太郎",
  kana: "やまだ たろう",
  birthDate: "1990-01-02",
  sex: "female",
  ...over,
});

describe("枠の初期表示（§5.5）", () => {
  it("大会の下限人数の枠を最初から出す", () => {
    expect(initialSlots(4)).toHaveLength(4);
    expect(initialSlots(4).every(isBlankSlot)).toBe(true);
    // 下限が 0 でも 1 枠は出す
    expect(initialSlots(0)).toHaveLength(1);
  });

  it("空の枠は「埋まっていない」", () => {
    expect(isBlankSlot(emptySlot())).toBe(true);
    expect(isBlankSlot(pick(1))).toBe(false);
    expect(isBlankSlot({ ...emptySlot(), kind: "manual", name: "山" })).toBe(false);
  });
});

describe("枠の検査", () => {
  it("空の枠は飛ばし、埋まっている枠だけを順番に返す", () => {
    const result = parsePlayerSlots([pick(1), emptySlot(), pick(2)], TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.players.map((p) => p.name)).toEqual(["選手1", "選手2"]);
  });

  it("同じ人を 2 つの枠には入れられない（二重選択の防止）", () => {
    const result = parsePlayerSlots([pick(1), pick(1)], TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([{ index: 1, field: "memberId", message: "選手1さんは1人目にも選ばれています" }]);
    }
  });

  it("選ぶ枠で人物が決まっていなければ誤り", () => {
    const result = parsePlayerSlots([{ ...emptySlot(), name: "山田" }], TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].field).toBe("memberId");
  });

  it("手入力は氏名・生年月日・性別がそろっていること（player-input.ts と同じ検査）", () => {
    const missingBirth = parsePlayerSlots([manual({ birthDate: null })], TODAY);
    expect(missingBirth.ok).toBe(false);
    if (!missingBirth.ok) expect(missingBirth.issues[0]).toMatchObject({ index: 0, field: "birthDate" });

    const missingSex = parsePlayerSlots([manual({ sex: "" })], TODAY);
    expect(missingSex.ok).toBe(false);
    if (!missingSex.ok) expect(missingSex.issues[0].field).toBe("sex");

    const ok = parsePlayerSlots([manual()], TODAY);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.players[0]).toMatchObject({ name: "山田 太郎", birthDate: "1990-01-02", sex: "female" });
  });

  it("誤りのある枠は添字つきで返す（該当する枠の下に出すため）", () => {
    const result = parsePlayerSlots([pick(1), manual({ sex: "" }), manual({ birthDate: null })], TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.index)).toEqual([1, 2]);
  });
});

describe("資格バリデーションへの受け渡し", () => {
  it("生年月日を PlainDate に直す", () => {
    expect(toEligibilityPlayers([{ name: "太郎", birthDate: "1980-04-01", sex: "male" }])).toEqual([
      { name: "太郎", birthDate: { year: 1980, month: 4, day: 1 }, sex: "male" },
    ]);
  });

  it("男女の人数を数える（混合の部の表示）", () => {
    expect(countBySex([{ sex: "male" }, { sex: "female" }, { sex: "male" }])).toEqual({ male: 2, female: 1 });
    expect(countBySex([])).toEqual({ male: 0, female: 0 });
  });
});
