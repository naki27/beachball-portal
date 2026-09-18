// src/lib/normalize.ts — 氏名・ふりがなの正規化の唯一の実装（設計書 §8.1・付録 B）
// DB 保存時（name_normalized / kana_normalized）と検索時の両方で必ずこれを使う。表示には使わない（原文は name / kana に残す）
// 順序が重要: 括弧の中身を消してから記号を消す。異体字の統一（髙→高 など）は v1 では行わない（§8.1）

// 2. 括弧付きの接頭／接尾辞。NFKC 後の ASCII 括弧と、NFKC で変わらない和文の括弧
const BRACKETED = /\([^)]*\)|\[[^\]]*\]|<[^>]*>|【[^】]*】|「[^」]*」|『[^』]*』/g;

export function normalizeName(input: string): string {
  let s = (input ?? "").normalize("NFKC"); // 1. 全角/半角の統一
  s = s.replace(BRACKETED, ""); // 2. 括弧付き接頭/接尾辞を中身ごと除去
  s = s.replace(/[\s　]+/g, ""); // 3. 空白除去
  s = s.toLowerCase(); // 4. 小文字化
  s = s.replace(/[^\p{L}\p{M}\p{N}ー]/gu, ""); // 5. 記号の除去（結合文字 \p{M} は消さない）
  s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); // 6. ひらがな → カタカナ
  return s;
}
// 長音の代わりに打たれたハイフン（「サトウ-タロウ」）は 5. で消える。長音「ー」は残る
// LIKE の特殊文字 % と _ も 5. で消えるため、付録 C でそのまま LIKE に使える
