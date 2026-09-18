import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext } from "./columns";

// 協会ごとの色（P1・§5.17）。NULL は既定の色
export type ThemeColors = { base: string; main: string; accent: string };

// テナント（協会）。最上位のテーブルで、協会に属するデータはすべて association_id を持つ（§7.0）。協会は物理削除しない
export const associations = pgTable(
  "associations",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    slug: text().notNull().unique(), // sawara
    contactEmail: citext(), // 問い合わせの転送先・メールの Reply-To（§5.10・§11）
    fiscalYearStartMonth: integer().notNull().default(4),
    themeColors: jsonb().$type<ThemeColors>(),
    logoStorageKey: text(), // ロゴ（R2 のキー）
    billingPlan: text().$type<"monthly" | "annual">(), // 利用料のプラン（§5.20・P1）
    status: text().notNull().default("active"), // 停止などの状態は利用料と一緒に決める（§5.20）
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("associations_fiscal_year_start_month_check", sql`${t.fiscalYearStartMonth} between 1 and 12`),
    check("associations_billing_plan_check", sql`${t.billingPlan} in ('monthly', 'annual')`),
  ],
);
