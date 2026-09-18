import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { PresetGender, PresetRuleType } from "../../lib/presets/default";
import { associations } from "./associations";
import { users } from "./users";

// 部門プリセット（テナントごと。協会によって構成が異なる。code は不変の識別子）
export const categoryPresets = pgTable(
  "category_presets",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid()
      .notNull()
      .references(() => associations.id, { onDelete: "cascade" }),
    code: text().notNull(), // m_free, m_40, w_60, x_160 ...
    labelDefault: text().notNull(), // 男子40歳以上の部 / 混合160オーバーの部
    gender: text().$type<PresetGender>().notNull(),
    ruleType: text().$type<PresetRuleType>().notNull(),
    ruleValue: integer(), // min_age: 40 / total_age: 160
    courtSize: integer().notNull().default(4), // コート上の人数（§14-20）
    mixedMinMale: integer().notNull().default(1), // 混合: 男の最少人数
    mixedMinFemale: integer().notNull().default(2), // 混合: 女の最少人数
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true), // false = 新しい大会の部門の候補に出さない（過去の大会の部門はそのまま）
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    // 子テーブル（大会の部門）が (association_id, preset_id) の複合外部キーで参照するため（§7.0）
    unique("category_presets_association_id_id_unique").on(t.associationId, t.id),
    check("category_presets_gender_check", sql`${t.gender} in ('male', 'female', 'mixed')`),
    check("category_presets_rule_type_check", sql`${t.ruleType} in ('free', 'min_age', 'total_age')`),
    check("category_presets_court_size_check", sql`${t.courtSize} >= 1`),
    // 混合の最少人数の合計はコート上の人数以下（§5.4）
    check(
      "category_presets_mixed_min_check",
      sql`${t.gender} <> 'mixed' or ${t.mixedMinMale} + ${t.mixedMinFemale} <= ${t.courtSize}`,
    ),
    check("category_presets_rule_value_check", sql`(${t.ruleType} = 'free') = (${t.ruleValue} is null)`),
    uniqueIndex("category_presets_code_uk").on(t.associationId, t.code).where(sql`${t.deletedAt} is null`),
  ],
);
