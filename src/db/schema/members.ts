import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { users } from "./users";

export type MemberSex = "male" | "female";
export type MemberStatus = "active" | "needs_review" | "merged";

// 人物（名簿に載る人・§5.15）。テナントに属する。ログインできるとは限らない
// 生年月日は「年月日」のまま文字列（YYYY-MM-DD）で扱い、JS の Date に変換しない（§7.0）
export const members = pgTable(
  "members",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid()
      .notNull()
      .references(() => associations.id),
    name: text().notNull(),
    kana: text(),
    birthDate: date({ mode: "string" }).notNull(), // 名寄せキー兼 年齢判定
    sex: text().$type<MemberSex>().notNull(),
    nameNormalized: text().notNull(), // src/lib/normalize.ts（A-04）
    kanaNormalized: text(),
    // 所属チームは team_members 経由で引く
    status: text().$type<MemberStatus>().notNull().default("active"),
    mergedIntoId: uuid().references((): AnyPgColumn => members.id),
    entryCount: integer().notNull().default(0),
    lastEntryAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userId: uuid().references(() => users.id), // 本人のアカウント（招待で紐づける・§5.15）
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    // 子テーブルが (association_id, member_id) の複合外部キーで参照するため（§7.0）
    unique("members_association_id_id_unique").on(t.associationId, t.id),
    check("members_sex_check", sql`${t.sex} in ('male', 'female')`),
    check("members_status_check", sql`${t.status} in ('active', 'needs_review', 'merged')`),
    // 協会内で 1 アカウント = 1 人物
    uniqueIndex("members_user_uk")
      .on(t.associationId, t.userId)
      .where(sql`${t.userId} is not null and ${t.deletedAt} is null`),
    // 部分一致・類似検索（§7.3）
    index("members_name_norm_trgm")
      .using("gin", t.nameNormalized.op("gin_trgm_ops"))
      .where(sql`${t.deletedAt} is null`),
    index("members_kana_norm_trgm")
      .using("gin", t.kanaNormalized.op("gin_trgm_ops"))
      .where(sql`${t.deletedAt} is null`),
    // 名寄せの主経路・テナント内検索。UNIQUE にはしない（同姓同名かつ同一生年月日の別人がありうる・§7.3）
    index("members_name_birth_idx")
      .on(t.associationId, t.nameNormalized, t.birthDate)
      .where(sql`${t.deletedAt} is null`),
  ],
);

// 人物の別名（旧姓・表記ゆれ）。名寄せで使う
export const memberAliases = pgTable(
  "member_aliases",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    memberId: uuid().notNull(),
    nameNormalized: text().notNull(),
    kanaNormalized: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "member_aliases_member_fk",
      columns: [t.associationId, t.memberId],
      foreignColumns: [members.associationId, members.id],
    }).onDelete("cascade"),
    unique("member_aliases_member_id_name_normalized_kana_normalized_unique").on(
      t.memberId,
      t.nameNormalized,
      t.kanaNormalized,
    ),
  ],
);
