import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { members } from "./members";
import { teams } from "./teams";
import { tournamentCategories, tournaments } from "./tournaments";
import { users } from "./users";

export type EntryStatus = "submitted" | "cancelled";

// 申込（§5.5）。取消は status、論理削除は deleted_at（別物・§5.16）
export const entries = pgTable(
  "entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    tournamentId: uuid().notNull(),
    categoryId: uuid().notNull(), // 部門は必須（§5.5）
    teamId: uuid().notNull(),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    teamName: text().notNull(), // 申込時点のスナップショット
    note: text(), // 連絡先はチーム（teams）に一本化
    status: text().$type<EntryStatus>().notNull().default("submitted"),
    needsAdminCheck: boolean().notNull().default(false), // 合計年齢部門など、運営の確認対象
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp({ withTimezone: true }),
    updatedBy: uuid().references(() => users.id), // 締切後の管理者編集を記録
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    unique("entries_association_id_id_unique").on(t.associationId, t.id),
    check("entries_status_check", sql`${t.status} in ('submitted', 'cancelled')`),
    foreignKey({
      name: "entries_tournament_fk",
      columns: [t.associationId, t.tournamentId],
      foreignColumns: [tournaments.associationId, tournaments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "entries_category_fk",
      columns: [t.associationId, t.categoryId],
      foreignColumns: [tournamentCategories.associationId, tournamentCategories.id],
    }).onDelete("cascade"),
    // 申込のあるチームは物理削除できない（§5.16）
    foreignKey({
      name: "entries_team_fk",
      columns: [t.associationId, t.teamId],
      foreignColumns: [teams.associationId, teams.id],
    }),
    // 部門がその大会のものであることはアプリで検査する（B-09）
    index("entries_tournament_idx").on(t.tournamentId, t.status).where(sql`${t.deletedAt} is null`),
    index("entries_created_by_idx").on(t.createdBy, t.submittedAt.desc()),
    index("entries_team_idx").on(t.teamId, t.submittedAt.desc()),
  ],
);

export type EntryPlayerMatchType = "picked" | "auto_exact" | "auto_new" | "unmatched";

// 申込の選手（申込時点のスナップショット。members が後から直されても申込内容は変わらない）
export const entryPlayers = pgTable(
  "entry_players",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    entryId: uuid().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    kana: text(),
    birthDate: date({ mode: "string" }), // 申込時は必須（アプリで検査）。人物の物理削除で NULL へ匿名化（§5.16）
    sex: text().$type<"male" | "female">().notNull(),
    ageAtEvent: integer(), // 基準日時点の満年齢（保存時に確定。基準日の変更は管理者の確定操作で再計算・§5.4）
    nameNormalized: text().notNull(),
    kanaNormalized: text(),
    memberId: uuid(), // 人物の物理削除で NULL（match_type = unmatched・§8.3）
    matchType: text().$type<EntryPlayerMatchType>(),
  },
  (t) => [
    check("entry_players_sex_check", sql`${t.sex} in ('male', 'female')`),
    check(
      "entry_players_match_type_check",
      sql`${t.matchType} in ('picked', 'auto_exact', 'auto_new', 'unmatched')`,
    ),
    foreignKey({
      name: "entry_players_entry_fk",
      columns: [t.associationId, t.entryId],
      foreignColumns: [entries.associationId, entries.id],
    }).onDelete("cascade"),
    // 人物を物理削除しても申込の行は残し、member_id だけ NULL にする（列を指定した SET NULL・§5.16）
    foreignKey({
      name: "entry_players_member_fk",
      columns: [t.associationId, t.memberId],
      foreignColumns: [members.associationId, members.id],
    }),
    unique("entry_players_entry_id_position_unique").on(t.entryId, t.position),
  ],
);

export type EntryAuditAction = "create" | "update" | "cancel" | "recalc_age" | "admin_checked";

// 申込の変更履歴（特に締切後の管理者による代理修正）
export const entryAudits = pgTable(
  "entry_audits",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    entryId: uuid().notNull(),
    actorId: uuid().references(() => users.id),
    action: text().$type<EntryAuditAction>().notNull(),
    before: jsonb().$type<Record<string, unknown>>(), // 生年月日は入れない（§5.16）
    after: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "entry_audits_action_check",
      sql`${t.action} in ('create', 'update', 'cancel', 'recalc_age', 'admin_checked')`,
    ),
    foreignKey({
      name: "entry_audits_entry_fk",
      columns: [t.associationId, t.entryId],
      foreignColumns: [entries.associationId, entries.id],
    }).onDelete("cascade"),
    index("entry_audits_entry_idx").on(t.entryId, t.createdAt.desc()),
  ],
);
