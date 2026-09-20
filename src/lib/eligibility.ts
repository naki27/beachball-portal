// src/lib/eligibility.ts — 部門の資格バリデーションの唯一の実装（設計書 §5.5(e)・付録 E）
// 判定に使う数値はすべて部門プリセットの設定値から読む（コート上の人数・混合の最少人数・年齢の基準をハードコードしない）
// 合計年齢の部は判定しない。数字を見せるだけで、最終的な資格確認は運営が行う（§14-20）
// DB を見る判定（同じ大会の別の申込との重複・名寄せの要確認）は送信処理の側で行う（§5.5・B-10）

import { ageAt } from "./age";
import type { PlainDate } from "./date";
import type { PresetGender, PresetRuleType } from "./presets/default";

export type EligibilityPlayer = { name: string; birthDate: PlainDate; sex: "male" | "female" };

// tournament_categories の行が指すプリセット（category_presets）の設定値
export type EligibilityPreset = {
  gender: PresetGender;
  ruleType: PresetRuleType;
  ruleValue: number | null;
  courtSize: number;
  mixedMinMale: number;
  mixedMinFemale: number;
};

// error は送信不可、warning は送信できる（§5.5 の警告の一覧）
// playerIndex は players の添字。該当する選手枠の下に出すため（§5.5「誰がどう不足しているかを名指しで」）
export type EligibilityIssue = { level: "error" | "warning"; message: string; playerIndex?: number };

// 画面に表示するだけの情報（合計年齢など）
export type EligibilityInfo = { label: string; value: string };

export type EligibilityResult = {
  issues: EligibilityIssue[];
  infos: EligibilityInfo[];
  needsAdminCheck: boolean;
};

const GENDER_LABEL: Record<PresetGender, string> = { male: "男子", female: "女子", mixed: "混合" };

export function validateEligibility(
  players: EligibilityPlayer[],
  preset: EligibilityPreset,
  referenceDate: PlainDate,
): EligibilityResult {
  const issues: EligibilityIssue[] = [];
  const infos: EligibilityInfo[] = [];
  let needsAdminCheck = false;
  const ages = players.map((p) => ageAt(p.birthDate, referenceDate));

  // --- 性別 ---
  if (preset.gender === "male" || preset.gender === "female") {
    players.forEach((p, index) => {
      if (p.sex !== preset.gender) {
        issues.push({
          level: "error",
          message: `${p.name}さんはこの部（${GENDER_LABEL[preset.gender]}）の対象ではありません`,
          playerIndex: index,
        });
      }
    });
  } else {
    // 混合: コート ${courtSize} 名で「男 ${mixedMinMale} 以上・女 ${mixedMinFemale} 以上」を満たす編成が組めるか
    // 登録名簿がその人数を満たしていればよい（男 3・女 1 だけの登録は組めないのでエラー）
    const males = players.filter((p) => p.sex === "male").length;
    const females = players.filter((p) => p.sex === "female").length;
    if (males < preset.mixedMinMale) {
      issues.push({
        level: "error",
        message: `混合の部は男子${preset.mixedMinMale}名以上の登録が必要です（現在${males}名）`,
      });
    }
    if (females < preset.mixedMinFemale) {
      issues.push({
        level: "error",
        message: `混合の部は女子${preset.mixedMinFemale}名以上の登録が必要です（現在${females}名）`,
      });
    }
  }

  // --- 年齢の下限: 全選手が対象 ---
  if (preset.ruleType === "min_age" && preset.ruleValue !== null) {
    const minAge = preset.ruleValue;
    players.forEach((p, index) => {
      if (ages[index] < minAge) {
        issues.push({
          level: "error",
          message: `この部は${minAge}歳以上が対象です（${p.name}さんは${ages[index]}歳）`,
          playerIndex: index,
        });
      }
    });
  }

  // --- 合計年齢: 判定しない。運営が確認するための数字を出すだけ（§14-20） ---
  if (preset.ruleType === "total_age" && preset.ruleValue !== null) {
    const n = preset.courtSize;
    const sorted = [...ages].sort((a, b) => a - b);
    const sum = (list: number[]) => list.reduce((total, age) => total + age, 0);
    // 登録が n 人に足りないときは、いる人だけで数える（人数の下限は別に見る・§5.4）
    const min = sum(sorted.slice(0, n));
    const max = sum(sorted.slice(-n));
    infos.push({ label: "合計年齢", value: `${min}歳〜${max}歳（出場する${n}人によって変わります。運営が確認します）` });
    infos.push({ label: "この部の基準", value: `${preset.ruleValue}歳以上` });
    // 基準に届かない可能性があるときは注意文を出すが、送信は止めない（§5.5(e)）
    if (max < preset.ruleValue) {
      issues.push({
        level: "warning",
        message: `どの${n}人で出場しても合計年齢が${preset.ruleValue}歳に届きません（最大${max}歳）。このまま送信できますが、運営が確認します`,
      });
    } else if (min < preset.ruleValue) {
      issues.push({
        level: "warning",
        message: `出場する${n}人によっては合計年齢が${preset.ruleValue}歳に届きません（${min}歳〜${max}歳）`,
      });
    }
    needsAdminCheck = true; // 合計年齢の部は運営の確認対象（§5.5）
  }

  return { issues, infos, needsAdminCheck };
}

// 送信できるか（警告は止めない）
export function hasEligibilityError(result: EligibilityResult): boolean {
  return result.issues.some((i) => i.level === "error");
}
