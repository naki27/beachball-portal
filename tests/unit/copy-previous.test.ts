import { describe, expect, it } from "vitest";
import { buildCopiedSlots, droppedMessage, pickCategoryByCode, type RosterPlayer } from "@/lib/entries/copy-previous";

// 前回コピー（設計書 §5.5(b)・B-11）
const roster: RosterPlayer[] = [
  { memberId: "11111111-1111-4111-8111-111111111111", name: "早良 太郎", kana: "さわら たろう", birthDate: "1980-04-01", sex: "male" },
  { memberId: "22222222-2222-4222-8222-222222222222", name: "早良 花子", kana: "さわら はなこ", birthDate: "1985-05-02", sex: "female" },
];

describe("選手の復元", () => {
  it("選手一覧にいる人は枠に戻り、生年月日・性別も入る", () => {
    const { slots, dropped } = buildCopiedSlots(
      [{ memberId: roster[0].memberId, name: "早良 太郎" }, { memberId: roster[1].memberId, name: "早良 花子" }],
      roster,
      4,
      7,
    );
    expect(dropped).toEqual([]);
    expect(slots.slice(0, 2)).toEqual([
      { kind: "pick", memberId: roster[0].memberId, name: "早良 太郎", kana: "さわら たろう", birthDate: "1980-04-01", sex: "male" },
      { kind: "pick", memberId: roster[1].memberId, name: "早良 花子", kana: "さわら はなこ", birthDate: "1985-05-02", sex: "female" },
    ]);
    // 下限の人数までは空の枠を出す
    expect(slots).toHaveLength(4);
    expect(slots[2].memberId).toBeNull();
  });

  it("脱退・削除された選手は戻さず、外した理由を伝える", () => {
    const { slots, dropped } = buildCopiedSlots(
      [
        { memberId: roster[0].memberId, name: "早良 太郎" },
        { memberId: "33333333-3333-4333-8333-333333333333", name: "やめた 次郎" }, // 選手一覧にいない
        { memberId: null, name: "消えた 三郎" }, // 人物が物理削除された申込の行（§5.16）
      ],
      roster,
      1,
      7,
    );
    expect(slots).toHaveLength(1);
    expect(dropped).toEqual(["やめた 次郎", "消えた 三郎"]);
    expect(droppedMessage(dropped)).toBe("やめた 次郎さん、消えた 三郎さんは選手一覧にいないため外しました");
    expect(droppedMessage([])).toBeNull();
  });

  it("大会の上限を超える分は戻さない", () => {
    const previous = [
      { memberId: roster[0].memberId, name: "早良 太郎" },
      { memberId: roster[1].memberId, name: "早良 花子" },
    ];
    const { slots, dropped } = buildCopiedSlots(previous, roster, 1, 1);
    expect(slots).toHaveLength(1);
    expect(dropped).toEqual(["早良 花子"]);
  });
});

describe("部の対応づけ", () => {
  const categories = [
    { id: "cat-mix", code: "x_160", label: "MIX160オーバーの部", selectable: true },
    { id: "cat-men", code: "m_free", label: "男子フリーの部", selectable: true },
    { id: "cat-closed", code: "w_free", label: "女子フリーの部", selectable: false },
  ];

  it("表示名が「混合160の部」から「MIX160オーバーの部」に変わっても code で対応づく", () => {
    expect(pickCategoryByCode(categories, "x_160")).toBe("cat-mix");
  });

  it("今回の大会にない部・選べない部は空のまま", () => {
    expect(pickCategoryByCode(categories, "m_60")).toBe("");
    expect(pickCategoryByCode(categories, "w_free")).toBe("");
  });
});
