import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext } from "./columns";

// アカウント。テナントに属さない。役割は platform_admins / association_admins / team_admins / members.user_id から導く（§7.0）
export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: citext().notNull(),
    displayName: text(),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    termsVersion: text(), // 同意した利用規約・プライバシーポリシーの版（§5.18）
    termsAcceptedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }), // 論理削除（§5.16）。本人による削除では email を元に戻せない値に置き換える（§5.19）
    deletedBy: uuid(),
  },
  (t) => [uniqueIndex("users_email_uk").on(t.email).where(sql`${t.deletedAt} is null`)],
);
