import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { members } from "./members";
import { teams } from "./teams";
import { users } from "./users";

export type MembershipStatus = "applied" | "approved" | "declined" | "expired";
export type MembershipSource = "renewal" | "additional" | "import";

// 年度別の協会員資格（§5.12）。年度 = 開始年（2026 年度 = 2026/4〜2027/3）
// 機能（年度更新）は 1d。B-08 のサジェストの絞り込みで参照するため表だけ先に作る
export const memberships = pgTable(
  "memberships",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    memberId: uuid().notNull(),
    teamId: uuid(), // 申告元のチーム
    year: integer().notNull(),
    status: text().$type<MembershipStatus>().notNull(),
    // renewal = 通常の申告 / additional = 年度途中の追加の申告（承認必須）/ import = 取り込み（§5.12）
    source: text().$type<MembershipSource>().notNull().default("renewal"),
    appliedBy: uuid().references(() => users.id),
    appliedAt: timestamp({ withTimezone: true }),
    approvedBy: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    check("memberships_status_check", sql`${t.status} in ('applied', 'approved', 'declined', 'expired')`),
    check("memberships_source_check", sql`${t.source} in ('renewal', 'additional', 'import')`),
    foreignKey({
      name: "memberships_member_fk",
      columns: [t.associationId, t.memberId],
      foreignColumns: [members.associationId, members.id],
    }).onDelete("cascade"),
    // チームを消しても資格は残し、team_id だけ NULL にする（列を指定した SET NULL）
    foreignKey({
      name: "memberships_team_fk",
      columns: [t.associationId, t.teamId],
      foreignColumns: [teams.associationId, teams.id],
    }),
    uniqueIndex("memberships_member_year_uk")
      .on(t.associationId, t.memberId, t.year)
      .where(sql`${t.deletedAt} is null`),
    index("memberships_year_idx").on(t.associationId, t.year, t.status),
  ],
);

// 年度更新の受付（運営が開始し、締切を持つ・§5.12）
export const membershipPeriods = pgTable(
  "membership_periods",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid()
      .notNull()
      .references(() => associations.id),
    year: integer().notNull(),
    opensAt: timestamp({ withTimezone: true }).notNull(),
    closesAt: timestamp({ withTimezone: true }).notNull(),
    autoApprove: boolean().notNull().default(false), // §14-27
  },
  (t) => [
    unique("membership_periods_association_id_year_unique").on(t.associationId, t.year),
    check("membership_periods_period_check", sql`${t.opensAt} < ${t.closesAt}`),
  ],
);

// チーム × 年度の申告の送信記録（§5.12）。行がない = 未申告
export const membershipDeclarations = pgTable(
  "membership_declarations",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    teamId: uuid().notNull(),
    year: integer().notNull(),
    submittedBy: uuid().references(() => users.id),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "membership_declarations_team_fk",
      columns: [t.associationId, t.teamId],
      foreignColumns: [teams.associationId, teams.id],
    }).onDelete("cascade"),
    unique("membership_declarations_association_id_team_id_year_unique").on(t.associationId, t.teamId, t.year),
  ],
);
