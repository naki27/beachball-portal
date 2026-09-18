// src/lib/matching.ts — 名寄せ（同じ人物に結びつけるか）の唯一の実装（設計書 §8.3）
// 判定は純粋な関数 decideMatch()。DB から候補を引く部分（listMatchCandidates）と、
// 判定に従って人物を結びつける・新しく作る部分（resolveMember）は分けてある
// チーム名は名寄せのキーに入れない（§14-12）。探す範囲は URL の協会の中だけ（§5.14）

import type { MemberSex, MemberStatus } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { normalizeName } from "@/lib/normalize";
import { createMember, findMember, listMatchCandidates } from "@/lib/repo/members";

// 名寄せのキー（正規化後の氏名・ふりがな、生年月日、性別）
export type MatchKeys = {
  nameNormalized: string;
  kanaNormalized: string | null; // 空は null
  birthDate: string; // YYYY-MM-DD（必須）
  sex: MemberSex;
};

// 入力した人（原文）。保存するのは原文、比べるのは正規化後
export type PersonInput = {
  name: string;
  kana: string | null;
  birthDate: string;
  sex: MemberSex;
};

// 申込の選手枠での利用者の選択（§8.3 ルール 0・1・1a）。選手一覧への追加では常に none（サジェストを使わない）
export type MatchChoice =
  | { kind: "none" }
  // ルール 0（チームの選手一覧から選んだ）・1（サジェスト・「この方ですか？」で「はい」）
  | { kind: "picked"; memberId: string }
  // ルール 1a（「この方ですか？」で「いいえ、別の方です」）
  | { kind: "declined" };

// 探索対象の人物（§8.3「探索対象」: 同じ協会・active / needs_review・削除されていない）
export type MatchCandidate = MatchKeys & { id: string; status: MemberStatus };

// どのルールで決まったか
export type MatchRule =
  | "picked" // 0・1
  | "declined" // 1a
  | "exact" // 2（氏名・生年月日・性別が一致する人がちょうど 1 人）
  | "sex_mismatch" // 2（氏名・生年月日は一致するが性別が違う）
  | "multiple" // 3（氏名・生年月日・性別が一致する人が複数）
  | "birth_mismatch" // 4（氏名は一致するが生年月日が違う）
  | "kana_birth" // 5（氏名は違うが、ふりがなと生年月日が一致。改姓の可能性）
  | "none"; // 6（該当なし）

export type MatchType = "picked" | "auto_exact" | "auto_new";

// 「ルールと記録の対応」の表（§8.3）。entry_players.match_type・人物・needs_review
// person: existing = 既存の人物に結びつける（needs_review は変えない）／ new = 新しく作る
export const MATCH_OUTCOMES: Record<MatchRule, { matchType: MatchType; person: "existing" | "new"; needsReview: boolean }> = {
  picked: { matchType: "picked", person: "existing", needsReview: false },
  declined: { matchType: "auto_new", person: "new", needsReview: true },
  exact: { matchType: "auto_exact", person: "existing", needsReview: false },
  sex_mismatch: { matchType: "auto_new", person: "new", needsReview: true },
  multiple: { matchType: "auto_new", person: "new", needsReview: true },
  birth_mismatch: { matchType: "auto_new", person: "new", needsReview: true },
  kana_birth: { matchType: "auto_new", person: "new", needsReview: true },
  none: { matchType: "auto_new", person: "new", needsReview: false },
};

export type MatchDecision =
  | { person: "existing"; rule: "picked" | "exact"; matchType: "picked" | "auto_exact"; memberId: string }
  | { person: "new"; rule: Exclude<MatchRule, "picked" | "exact">; matchType: "auto_new"; needsReview: boolean };

// 原文から名寄せのキーを作る（正規化は normalize.ts だけ）
export function matchKeysOf(person: PersonInput): MatchKeys {
  const kana = person.kana ? normalizeName(person.kana) : "";
  return {
    nameNormalized: normalizeName(person.name),
    kanaNormalized: kana || null,
    birthDate: person.birthDate,
    sex: person.sex,
  };
}

function newPerson(rule: Exclude<MatchRule, "picked" | "exact">): MatchDecision {
  return { person: "new", rule, matchType: "auto_new", needsReview: MATCH_OUTCOMES[rule].needsReview };
}

// 名寄せの判定（§8.3 ルール 0〜6）。candidates は探索対象の人物（ほかの協会・merged・削除済みを含めない）
// ルール 7: 既存の人物どうしをまとめることは決してしない（この関数は結びつけるか新しく作るかだけを返す）
export function decideMatch(keys: MatchKeys, choice: MatchChoice, candidates: readonly MatchCandidate[]): MatchDecision {
  // 0・1: 選ばれた人物にそのまま結びつける
  if (choice.kind === "picked") {
    return { person: "existing", rule: "picked", matchType: "picked", memberId: choice.memberId };
  }
  // 1a: 利用者が「別の方」と答えたら、一致していても自動では結びつけない
  if (choice.kind === "declined") return newPerson("declined");

  const sameNameAndBirth = candidates.filter((c) => c.nameNormalized === keys.nameNormalized && c.birthDate === keys.birthDate);
  const sameSex = sameNameAndBirth.filter((c) => c.sex === keys.sex);
  // 2: 氏名・生年月日・性別が一致する人がちょうど 1 人 → 結びつける（ふりがなが違っていてもよい）
  if (sameSex.length === 1) {
    return { person: "existing", rule: "exact", matchType: "auto_exact", memberId: sameSex[0].id };
  }
  // 3: 複数 → 新しく作って人が見る（同姓同名・同一生年月日）
  if (sameSex.length > 1) return newPerson("multiple");
  // 2 の後半: 氏名・生年月日は一致するが性別が違う → 入力の誤りかもしれないので、新しく作って人が見る
  if (sameNameAndBirth.length > 0) return newPerson("sex_mismatch");
  // 4: 氏名は一致するが生年月日が違う → 別人として新しく作る。生年月日の打ち間違いかもしれないので人が見る
  if (candidates.some((c) => c.nameNormalized === keys.nameNormalized)) return newPerson("birth_mismatch");
  // 5: ふりがなと生年月日が一致（改姓の可能性）→ 結びつけずに新しく作って人が見る
  //    ふりがなが入力側・既存側の両方で空でないときだけ（空どうしを一致とみなさない）
  if (
    keys.kanaNormalized &&
    candidates.some((c) => c.kanaNormalized && c.kanaNormalized === keys.kanaNormalized && c.birthDate === keys.birthDate)
  ) {
    return newPerson("kana_birth");
  }
  // 6: 該当なし → 新しく作る
  return newPerson("none");
}

// DB から探索対象を引いて判定する（人物は作らない）。withTenant の tx の中で呼ぶ
export async function findMatch(
  tx: Tx,
  associationId: string,
  person: PersonInput,
  choice: MatchChoice = { kind: "none" },
): Promise<MatchDecision> {
  const keys = matchKeysOf(person);
  if (choice.kind !== "none") return decideMatch(keys, choice, []);
  const candidates = await listMatchCandidates(tx, associationId, keys);
  return decideMatch(keys, choice, candidates);
}

export class MatchingError extends Error {}

export type ResolvedMember = { memberId: string; matchType: MatchType; rule: MatchRule; created: boolean; needsReview: boolean };

// 判定に従って人物を決める。新しく作るときは needs_review を新しい側に立てる（既存の人物は変えない・ルール 7）
// 選ばれた人物（picked）は同じ協会にいて、削除・統合されていないことを確かめる（選んでよい人かは呼ぶ側が確かめる）
export async function resolveMember(
  tx: Tx,
  associationId: string,
  person: PersonInput,
  choice: MatchChoice = { kind: "none" },
): Promise<ResolvedMember> {
  const decision = await findMatch(tx, associationId, person, choice);
  if (decision.person === "existing") {
    const member = await findMember(tx, associationId, decision.memberId);
    if (!member || member.status === "merged") throw new MatchingError("選ばれた人物が見つかりません");
    return { memberId: member.id, matchType: decision.matchType, rule: decision.rule, created: false, needsReview: false };
  }
  const keys = matchKeysOf(person);
  const created = await createMember(tx, associationId, {
    name: person.name,
    kana: person.kana || null,
    birthDate: person.birthDate,
    sex: person.sex,
    nameNormalized: keys.nameNormalized,
    kanaNormalized: keys.kanaNormalized,
    status: decision.needsReview ? "needs_review" : "active",
  });
  return { memberId: created.id, matchType: "auto_new", rule: decision.rule, created: true, needsReview: decision.needsReview };
}
