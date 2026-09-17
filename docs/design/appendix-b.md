## 付録 B. `normalizeName` 実装イメージ（TypeScript）

```ts
// src/lib/normalize.ts — 唯一の実装。DB 保存時と検索時の両方で必ずこれを使う
// v0.9: 括弧の正規表現を固定の 1 本にした（文字列から組み立てるとエスケープの誤りが起きやすい）。
// 異体字の統一は v1 では行わない（§8.1）。

// 2. 括弧付きの接頭／接尾辞。NFKC 後の ASCII 括弧と、NFKC で変わらない和文の括弧
const BRACKETED = /\([^)]*\)|\[[^\]]*\]|<[^>]*>|【[^】]*】|「[^」]*」|『[^』]*』/g;

export function normalizeName(input: string): string {
  let s = (input ?? "").normalize("NFKC");                       // 1. 全角/半角の統一
  s = s.replace(BRACKETED, "");                                   // 2. 括弧付き接頭/接尾辞を中身ごと除去
  s = s.replace(/[\s\u3000]+/g, "");                              // 3. 空白除去
  s = s.toLowerCase();                                            // 4. 小文字化
  s = s.replace(/[^\p{L}\p{M}\p{N}ー]/gu, "");                     // 5. 記号の除去（結合文字 \p{M} は消さない）
  s = s.replace(/[\u3041-\u3096]/g,                               // 6. ひらがな → カタカナ
    (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return s;
}
// 長音の代わりに打たれたハイフン（「サトウ-タロウ」）は 5. で消える。長音「ー」は残る。
// LIKE の特殊文字 % と _ も 5. で消えるため、付録 C でそのまま LIKE に使える。
```

