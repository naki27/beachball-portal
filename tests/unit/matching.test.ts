import { describe, expect, it } from "vitest";
import {
  decideMatch,
  MATCH_OUTCOMES,
  type MatchCandidate,
  type MatchChoice,
  type MatchKeys,
  type MatchRule,
  matchKeysOf,
} from "@/lib/matching";

// 名寄せのルール（設計書 §8.3）。判定は純粋な関数なので DB なしで確かめる
const NONE: MatchChoice = { kind: "none" };

const input: MatchKeys = matchKeysOf({ name: "山田 太郎", kana: "やまだ たろう", birthDate: "1965-05-03", sex: "male" });

function candidate(id: string, overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id,
    nameNormalized: input.nameNormalized,
    kanaNormalized: input.kanaNormalized,
    birthDate: input.birthDate,
    sex: input.sex,
    status: "active",
    ...overrides,
  };
}

describe("matchKeysOf（正規化は normalize.ts）", () => {
  it("氏名・ふりがなを正規化し、空のふりがなは null", () => {
    expect(input).toEqual({ nameNormalized: "山田太郎", kanaNormalized: "ヤマダタロウ", birthDate: "1965-05-03", sex: "male" });
    expect(matchKeysOf({ name: "山田　太郎", kana: "　", birthDate: "1965-05-03", sex: "male" }).kanaNormalized).toBeNull();
    expect(matchKeysOf({ name: "山田太郎", kana: null, birthDate: "1965-05-03", sex: "male" }).kanaNormalized).toBeNull();
  });
});

describe("decideMatch（§8.3 ルール 0〜7）", () => {
  it("0・1: 選ばれた人物（member_id あり）にはそのまま結びつける（picked）", () => {
    // 候補が別にいても、選択が優先
    expect(decideMatch(input, { kind: "picked", memberId: "m-picked" }, [candidate("m-other")])).toEqual({
      person: "existing",
      rule: "picked",
      matchType: "picked",
      memberId: "m-picked",
    });
  });

  it("1a: 「いいえ、別の方です」なら、氏名＋生年月日＋性別が一致していても結びつけず、新しく作って要確認", () => {
    expect(decideMatch(input, { kind: "declined" }, [candidate("m1")])).toEqual({
      person: "new",
      rule: "declined",
      matchType: "auto_new",
      needsReview: true,
    });
  });

  it("2: 氏名・生年月日・性別が一致する人がちょうど 1 人 → 結びつける（auto_exact）", () => {
    expect(decideMatch(input, NONE, [candidate("m1")])).toEqual({
      person: "existing",
      rule: "exact",
      matchType: "auto_exact",
      memberId: "m1",
    });
  });

  it("2: ふりがなが違っていても（空でも）、氏名＋生年月日＋性別が一致すれば同じ人", () => {
    expect(decideMatch(input, NONE, [candidate("m1", { kanaNormalized: "ヤマダタロ" })])).toMatchObject({ memberId: "m1" });
    expect(decideMatch(input, NONE, [candidate("m1", { kanaNormalized: null })])).toMatchObject({ memberId: "m1" });
  });

  it("2: 性別だけ違う → 結びつけず、新しく作って要確認", () => {
    expect(decideMatch(input, NONE, [candidate("m1", { sex: "female" })])).toEqual({
      person: "new",
      rule: "sex_mismatch",
      matchType: "auto_new",
      needsReview: true,
    });
  });

  it("2: 氏名・生年月日が同じ 2 人のうち性別が合うのが 1 人なら、その人に結びつける", () => {
    expect(decideMatch(input, NONE, [candidate("m-f", { sex: "female" }), candidate("m-m")])).toMatchObject({
      rule: "exact",
      memberId: "m-m",
    });
  });

  it("3: 氏名・生年月日・性別が一致する人が複数 → 新しく作って要確認", () => {
    expect(decideMatch(input, NONE, [candidate("m1"), candidate("m2")])).toEqual({
      person: "new",
      rule: "multiple",
      matchType: "auto_new",
      needsReview: true,
    });
  });

  it("4: 氏名は一致するが生年月日が違う → 別人として新しく作り、要確認", () => {
    expect(decideMatch(input, NONE, [candidate("m1", { birthDate: "1965-05-04" })])).toMatchObject({
      person: "new",
      rule: "birth_mismatch",
      needsReview: true,
    });
  });

  it("5: 氏名は違うが、ふりがなと生年月日が一致 → 改姓の可能性。結びつけずに新しく作って要確認", () => {
    expect(decideMatch(input, NONE, [candidate("m1", { nameNormalized: "佐藤太郎" })])).toMatchObject({
      person: "new",
      rule: "kana_birth",
      needsReview: true,
    });
  });

  it("5: ふりがなが空どうし（入力側・既存側のどちらかでも空）ならルール 5 を使わない", () => {
    const noKana = { ...input, kanaNormalized: null };
    expect(decideMatch(noKana, NONE, [candidate("m1", { nameNormalized: "佐藤太郎", kanaNormalized: null })])).toMatchObject({
      rule: "none",
      needsReview: false,
    });
    expect(decideMatch(noKana, NONE, [candidate("m1", { nameNormalized: "佐藤太郎" })])).toMatchObject({ rule: "none" });
    expect(decideMatch(input, NONE, [candidate("m1", { nameNormalized: "佐藤太郎", kanaNormalized: null })])).toMatchObject({
      rule: "none",
    });
  });

  it("5: ふりがなが一致しても生年月日が違えば該当なし", () => {
    expect(
      decideMatch(input, NONE, [candidate("m1", { nameNormalized: "佐藤太郎", birthDate: "1970-01-01" })]),
    ).toMatchObject({ rule: "none" });
  });

  it("6: 該当なし → 新しく作る（要確認にしない）", () => {
    expect(decideMatch(input, NONE, [])).toEqual({ person: "new", rule: "none", matchType: "auto_new", needsReview: false });
  });

  it("要確認（needs_review）の人物も探索対象として同じに扱う（何度も新しく作られないように）", () => {
    expect(decideMatch(input, NONE, [candidate("m1", { status: "needs_review" })])).toMatchObject({ rule: "exact", memberId: "m1" });
  });
});

describe("「ルールと記録の対応」の表（§8.3）", () => {
  // 各ルールに当たる場面 → 判定がこの表のとおりか
  const scenarios: Record<MatchRule, { choice: MatchChoice; candidates: MatchCandidate[] }> = {
    picked: { choice: { kind: "picked", memberId: "m1" }, candidates: [] },
    declined: { choice: { kind: "declined" }, candidates: [candidate("m1")] },
    exact: { choice: NONE, candidates: [candidate("m1")] },
    sex_mismatch: { choice: NONE, candidates: [candidate("m1", { sex: "female" })] },
    multiple: { choice: NONE, candidates: [candidate("m1"), candidate("m2")] },
    birth_mismatch: { choice: NONE, candidates: [candidate("m1", { birthDate: "2000-01-01" })] },
    kana_birth: { choice: NONE, candidates: [candidate("m1", { nameNormalized: "佐藤太郎" })] },
    none: { choice: NONE, candidates: [] },
  };

  it.each(Object.keys(MATCH_OUTCOMES) as MatchRule[])("%s", (rule) => {
    const { choice, candidates } = scenarios[rule];
    const decision = decideMatch(input, choice, candidates);
    const expected = MATCH_OUTCOMES[rule];
    expect(decision.rule).toBe(rule);
    expect(decision.matchType).toBe(expected.matchType);
    expect(decision.person).toBe(expected.person);
    expect(decision.person === "new" ? decision.needsReview : false).toBe(expected.needsReview);
  });

  it("表の中身（picked / auto_exact は既存の人物、ほかは新規。要確認はルール 1a・2 の性別違い・3・4・5）", () => {
    expect(MATCH_OUTCOMES).toEqual({
      picked: { matchType: "picked", person: "existing", needsReview: false },
      declined: { matchType: "auto_new", person: "new", needsReview: true },
      exact: { matchType: "auto_exact", person: "existing", needsReview: false },
      sex_mismatch: { matchType: "auto_new", person: "new", needsReview: true },
      multiple: { matchType: "auto_new", person: "new", needsReview: true },
      birth_mismatch: { matchType: "auto_new", person: "new", needsReview: true },
      kana_birth: { matchType: "auto_new", person: "new", needsReview: true },
      none: { matchType: "auto_new", person: "new", needsReview: false },
    });
  });
});
