import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { users } from "./users";

export type ContactMessageSubjectType = "変更" | "取消" | "ログイン" | "削除" | "その他";
export type ContactMessageStatus = "new" | "done";
export type PlatformContactMessageSubjectType = "ログイン" | "削除" | "その他";

export const contactMessages = pgTable(
  "contact_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid()
      .notNull()
      .references(() => associations.id),
    tournamentId: uuid(),
    entryId: uuid(),
    userId: uuid().references(() => users.id),
    subjectType: text().$type<ContactMessageSubjectType>().notNull(),
    senderName: text().notNull(),
    senderEmail: text().notNull(),
    body: text().notNull(),
    status: text().$type<ContactMessageStatus>().notNull().default("new"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    check("contact_messages_subject_type_check", sql`${t.subjectType} in ('変更', '取消', 'ログイン', '削除', 'その他')`),
    check("contact_messages_status_check", sql`${t.status} in ('new', 'done')`),
  ],
);

export const platformContactMessages = pgTable(
  "platform_contact_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid().references(() => users.id),
    subjectType: text().$type<PlatformContactMessageSubjectType>().notNull(),
    senderName: text().notNull(),
    senderEmail: text().notNull(),
    body: text().notNull(),
    status: text().$type<ContactMessageStatus>().notNull().default("new"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("platform_contact_messages_subject_type_check", sql`${t.subjectType} in ('ログイン', '削除', 'その他')`),
    check("platform_contact_messages_status_check", sql`${t.status} in ('new', 'done')`),
  ],
);
