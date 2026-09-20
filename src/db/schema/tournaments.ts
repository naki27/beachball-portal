import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { categoryPresets } from "./category-presets";
import { users } from "./users";

export type TournamentStatus = "draft" | "open" | "closed" | "archived";

// 大会（§5.4）。日付は「年月日」のまま文字列で扱い、JS の Date に変換しない（§7.0）
// 申込の開始・締切は日付で入力し、日本時間の 0:00 / 23:59:59 で保存する（変換は B-04）
export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid()
      .notNull()
      .references(() => associations.id),
    name: text().notNull(),
    eventDate: date({ mode: "string" }),
    ageReferenceDate: date({ mode: "string" }).notNull(), // 年齢の基準日（要項ごとに異なる・§14-21）
    venue: text(),
    description: text(),
    entryStartAt: timestamp({ withTimezone: true }),
    entryEndAt: timestamp({ withTimezone: true }).notNull(),
    teamSizeMin: integer().notNull().default(4),
    teamSizeMax: integer().notNull().default(7),
    maxEntries: integer(), // NULL = 上限なし
    status: text().$type<TournamentStatus>().notNull().default("draft"),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    // 子テーブルが (association_id, tournament_id) の複合外部キーで参照するため（§7.0）
    unique("tournaments_association_id_id_unique").on(t.associationId, t.id),
    check("tournaments_status_check", sql`${t.status} in ('draft', 'open', 'closed', 'archived')`),
    check("tournaments_max_entries_check", sql`${t.maxEntries} is null or ${t.maxEntries} > 0`),
    check("tournaments_team_size_check", sql`${t.teamSizeMin} >= 1 and ${t.teamSizeMin} <= ${t.teamSizeMax}`),
    check("tournaments_entry_period_check", sql`${t.entryStartAt} is null or ${t.entryStartAt} < ${t.entryEndAt}`),
    // team_size_min >= 部門の court_size は表をまたぐのでアプリで検証する（§5.4・B-04）
  ],
);

// 大会の部門（プリセットのコピー。判定に使う数値はプリセット側から読む・§5.4）
export const tournamentCategories = pgTable(
  "tournament_categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    tournamentId: uuid().notNull(),
    presetId: uuid().notNull(),
    code: text().notNull(), // preset.code のコピー（突合用）
    label: text().notNull(), // 大会ごとの表示名（混合 / MIX の差を吸収）
    entryEndAt: timestamp({ withTimezone: true }), // NULL なら大会の締切
    ageReferenceDate: date({ mode: "string" }), // NULL なら大会の基準日
    sortOrder: integer().notNull().default(0),
    maxEntries: integer(), // 部門ごとの申込上限（大会の上限と両方を見る・§5.4）
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    unique("tournament_categories_association_id_id_unique").on(t.associationId, t.id),
    check("tournament_categories_max_entries_check", sql`${t.maxEntries} is null or ${t.maxEntries} > 0`),
    foreignKey({
      name: "tournament_categories_tournament_fk",
      columns: [t.associationId, t.tournamentId],
      foreignColumns: [tournaments.associationId, tournaments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "tournament_categories_preset_fk",
      columns: [t.associationId, t.presetId],
      foreignColumns: [categoryPresets.associationId, categoryPresets.id],
    }),
    // 前回コピー・年度比較はこのキーで突合（§5.4）
    uniqueIndex("tournament_categories_code_uk").on(t.tournamentId, t.code).where(sql`${t.deletedAt} is null`),
  ],
);
