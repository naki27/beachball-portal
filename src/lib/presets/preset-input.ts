import { cleanText } from "@/lib/teams/team-input";
import { readIntField } from "@/lib/tournaments/tournament-input";
import { PRESET_GENDERS, PRESET_RULE_TYPES, type PresetGender, type PresetRuleType } from "./default";

// 部門プリセットの入力（設計書 §5.4「部門（カテゴリ）の設計」）。テナント設定（/admin/association）で編集する
// code は協会の中で不変の識別子（前回コピー・年度比較の突合に使う）。作ったあとは変えられない

export const PRESET_CODE_MAX = 30;
export const PRESET_LABEL_MAX = 60;
export const PRESET_COURT_SIZE_LIMIT = 30;
export const PRESET_MIN_AGE_LIMIT = 120;
export const PRESET_TOTAL_AGE_LIMIT = 999;

export type PresetInput = {
  code: string;
  labelDefault: string;
  gender: PresetGender;
  ruleType: PresetRuleType;
  ruleValue: number | null;
  courtSize: number;
  mixedMinMale: number;
  mixedMinFemale: number;
  sortOrder: number;
  isActive: boolean;
};

export type PresetField = keyof PresetInput;

export type PresetInputResult = { ok: true; value: PresetInput } | { ok: false; field: PresetField; message: string };

const fail = (field: PresetField, message: string): PresetInputResult => ({ ok: false, field, message });

// 画面に出す呼び名（内部の値を出さない・§4.4）
export const PRESET_GENDER_LABEL: Record<PresetGender, string> = { male: "男子", female: "女子", mixed: "混合" };
export const PRESET_RULE_TYPE_LABEL: Record<PresetRuleType, string> = {
  free: "年齢の制限なし",
  min_age: "全員が◯歳以上",
  total_age: "合計年齢が◯以上（運営が確認）",
};

export function parsePresetInput(raw: Record<string, unknown>): PresetInputResult {
  const code = cleanText(raw.code).toLowerCase();
  if (!code) return fail("code", "記号を入力してください（例: m_40）");
  if (code.length > PRESET_CODE_MAX) return fail("code", `記号は${PRESET_CODE_MAX}文字以内で入力してください`);
  if (!/^[a-z0-9_]+$/.test(code)) return fail("code", "記号は半角の英小文字・数字・_ だけで入力してください（例: m_40）");

  const labelDefault = cleanText(raw.labelDefault);
  if (!labelDefault) return fail("labelDefault", "部の名前を入力してください");
  if ([...labelDefault].length > PRESET_LABEL_MAX) {
    return fail("labelDefault", `部の名前は${PRESET_LABEL_MAX}文字以内で入力してください`);
  }

  const genderText = cleanText(raw.gender);
  if (!(PRESET_GENDERS as readonly string[]).includes(genderText)) return fail("gender", "男女の別を選んでください");
  const gender = genderText as PresetGender;

  const ruleTypeText = cleanText(raw.ruleType);
  if (!(PRESET_RULE_TYPES as readonly string[]).includes(ruleTypeText)) return fail("ruleType", "年齢の条件を選んでください");
  const ruleType = ruleTypeText as PresetRuleType;

  const ruleValueInput = readIntField(raw.ruleValue);
  if (ruleValueInput === "invalid") return fail("ruleValue", "年齢の数を数で入力してください");
  // DB の CHECK と同じ規則: 制限なしのときだけ空欄（§5.4）
  if (ruleType === "free") {
    if (ruleValueInput !== null) return fail("ruleValue", "年齢の制限なしのときは、年齢の数を空欄にしてください");
  } else if (ruleValueInput === null) {
    return fail("ruleValue", "年齢の数を入力してください");
  }
  const limit = ruleType === "total_age" ? PRESET_TOTAL_AGE_LIMIT : PRESET_MIN_AGE_LIMIT;
  if (ruleValueInput !== null && (ruleValueInput < 1 || ruleValueInput > limit)) {
    return fail("ruleValue", `年齢の数は 1〜${limit} で入力してください`);
  }

  const courtSize = readIntField(raw.courtSize);
  if (courtSize === "invalid" || courtSize === null) return fail("courtSize", "コートに出る人数を数で入力してください");
  if (courtSize < 1 || courtSize > PRESET_COURT_SIZE_LIMIT) {
    return fail("courtSize", `コートに出る人数は 1〜${PRESET_COURT_SIZE_LIMIT} で入力してください`);
  }

  const mixedMinMale = readIntField(raw.mixedMinMale);
  if (mixedMinMale === "invalid" || mixedMinMale === null || mixedMinMale < 0) {
    return fail("mixedMinMale", "コートに出る男性の最少人数を数で入力してください");
  }
  const mixedMinFemale = readIntField(raw.mixedMinFemale);
  if (mixedMinFemale === "invalid" || mixedMinFemale === null || mixedMinFemale < 0) {
    return fail("mixedMinFemale", "コートに出る女性の最少人数を数で入力してください");
  }
  if (gender === "mixed" && mixedMinMale + mixedMinFemale > courtSize) {
    return fail("mixedMinFemale", "男性と女性の最少人数の合計は、コートに出る人数以内にしてください");
  }

  const sortOrder = readIntField(raw.sortOrder);
  if (sortOrder === "invalid" || sortOrder === null || sortOrder < 0 || sortOrder > 9999) {
    return fail("sortOrder", "並び順は 0〜9999 の数で入力してください");
  }

  return {
    ok: true,
    value: {
      code,
      labelDefault,
      gender,
      ruleType,
      ruleValue: ruleValueInput,
      courtSize,
      mixedMinMale,
      mixedMinFemale,
      sortOrder,
      isActive: raw.isActive !== false && raw.isActive !== "false",
    },
  };
}
