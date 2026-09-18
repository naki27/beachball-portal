// 部門プリセットの既定（設計書 付録 A「部門プリセットの seed」）。seed が早良区協会に入れる
// 男子・女子はフリー/18/30/40/50/60/70、混合はフリー/160/180/200。混合の男女比（男 1 以上・女 2 以上）とコート人数 4 は列の既定値

export const PRESET_GENDERS = ["male", "female", "mixed"] as const;
export type PresetGender = (typeof PRESET_GENDERS)[number];

export const PRESET_RULE_TYPES = ["free", "min_age", "total_age"] as const;
export type PresetRuleType = (typeof PRESET_RULE_TYPES)[number];

export type CategoryPresetDefault = {
  code: string;
  labelDefault: string;
  gender: PresetGender;
  ruleType: PresetRuleType;
  ruleValue: number | null; // free のときだけ null
  sortOrder: number;
};

export const DEFAULT_CATEGORY_PRESETS: readonly CategoryPresetDefault[] = [
  { code: "m_free", labelDefault: "男子フリーの部", gender: "male", ruleType: "free", ruleValue: null, sortOrder: 10 },
  { code: "m_18", labelDefault: "男子18歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 18, sortOrder: 11 },
  { code: "m_30", labelDefault: "男子30歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 30, sortOrder: 12 },
  { code: "m_40", labelDefault: "男子40歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 40, sortOrder: 13 },
  { code: "m_50", labelDefault: "男子50歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 50, sortOrder: 14 },
  { code: "m_60", labelDefault: "男子60歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 60, sortOrder: 15 },
  { code: "m_70", labelDefault: "男子70歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 70, sortOrder: 16 },
  { code: "w_free", labelDefault: "女子フリーの部", gender: "female", ruleType: "free", ruleValue: null, sortOrder: 20 },
  { code: "w_18", labelDefault: "女子18歳以上の部", gender: "female", ruleType: "min_age", ruleValue: 18, sortOrder: 21 },
  { code: "w_30", labelDefault: "女子30歳以上の部", gender: "female", ruleType: "min_age", ruleValue: 30, sortOrder: 22 },
  { code: "w_40", labelDefault: "女子40歳以上の部", gender: "female", ruleType: "min_age", ruleValue: 40, sortOrder: 23 },
  { code: "w_50", labelDefault: "女子50歳以上の部", gender: "female", ruleType: "min_age", ruleValue: 50, sortOrder: 24 },
  { code: "w_60", labelDefault: "女子60歳以上の部", gender: "female", ruleType: "min_age", ruleValue: 60, sortOrder: 25 },
  { code: "w_70", labelDefault: "女子70歳以上の部", gender: "female", ruleType: "min_age", ruleValue: 70, sortOrder: 26 },
  { code: "x_free", labelDefault: "混合フリーの部", gender: "mixed", ruleType: "free", ruleValue: null, sortOrder: 30 },
  { code: "x_160", labelDefault: "混合160オーバーの部", gender: "mixed", ruleType: "total_age", ruleValue: 160, sortOrder: 31 },
  { code: "x_180", labelDefault: "混合180オーバーの部", gender: "mixed", ruleType: "total_age", ruleValue: 180, sortOrder: 32 },
  { code: "x_200", labelDefault: "混合200オーバーの部", gender: "mixed", ruleType: "total_age", ruleValue: 200, sortOrder: 33 },
];
