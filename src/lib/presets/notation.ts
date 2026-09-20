// 混合の部の表記（「混合」/「MIX」）の切り替え（設計書 §5.4「部門（カテゴリ）の設計」）
// 大会ごとに表記が変わるだけで、突合に使う code は変えない。プリセットの既定名から label を作るのはここ 1 か所

import type { PresetGender } from "./default";

export const MIXED_NOTATIONS = ["kanji", "mix"] as const;
export type MixedNotation = (typeof MIXED_NOTATIONS)[number];

// 画面に出す選択肢の名前（§4.4）
export const MIXED_NOTATION_LABEL: Record<MixedNotation, string> = {
  kanji: "混合（例: 混合160オーバーの部）",
  mix: "MIX（例: MIX160オーバーの部）",
};

export function isMixedNotation(value: unknown): value is MixedNotation {
  return typeof value === "string" && (MIXED_NOTATIONS as readonly string[]).includes(value);
}

// プリセットの既定名から、その大会で使う表示名を作る。混合以外の部はそのまま
export function applyMixedNotation(labelDefault: string, gender: PresetGender, notation: MixedNotation): string {
  if (gender !== "mixed") return labelDefault;
  return notation === "mix" ? labelDefault.replaceAll("混合", "MIX") : labelDefault.replaceAll("MIX", "混合");
}
