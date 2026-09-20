import { formatDateWithWeekday, type PlainDate } from "@/lib/date";
import type { PresetGender, PresetRuleType } from "@/lib/presets/default";

// 部の条件の文章（設計書 §5.4・§5.6「部の条件の文章」）。大会詳細・管理画面・申込ページで同じ文を出す
// 判定そのものは eligibility.ts。ここは「その部に出られるのはどんなチームか」を日本語にするだけ

export type CategoryCondition = {
  gender: PresetGender;
  ruleType: PresetRuleType;
  ruleValue: number | null;
  courtSize: number;
  mixedMinMale: number;
  mixedMinFemale: number;
};

// 基準日の書き方は 1 か所（「2026年9月30日（水）時点」）
export function ageReferenceText(referenceDate: PlainDate): string {
  return `${referenceDate.year}年${formatDateWithWeekday(referenceDate)}時点`;
}

// 男女の条件
export function genderConditionText(c: CategoryCondition): string {
  if (c.gender === "male") return "男性だけで出場します";
  if (c.gender === "female") return "女性だけで出場します";
  return `コートに出る${c.courtSize}人のうち、男性${c.mixedMinMale}人以上・女性${c.mixedMinFemale}人以上です`;
}

// 年齢の条件（基準日つき）
export function ageConditionText(c: CategoryCondition, referenceDate: PlainDate): string {
  if (c.ruleType === "min_age" && c.ruleValue !== null) {
    return `出場する全員が${c.ruleValue}歳以上です（${ageReferenceText(referenceDate)}）`;
  }
  if (c.ruleType === "total_age" && c.ruleValue !== null) {
    return `コートに出る${c.courtSize}人の合計年齢が${c.ruleValue}歳以上です（${ageReferenceText(referenceDate)}・運営が確認します）`;
  }
  return "年齢の制限はありません";
}

// 2 つを並べた 1 行の文章
export function categoryConditionText(c: CategoryCondition, referenceDate: PlainDate): string {
  return `${genderConditionText(c)}。${ageConditionText(c, referenceDate)}。`;
}
