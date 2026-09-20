import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { entries } from "./entries";
import { tournaments } from "./tournaments";
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
    tournamentId: uuid().references(() => tournaments.id, { onDelete: "set null" }),
    entryId: uuid(), // 複合外部キーは下（列を指定した SET NULL）
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
    // 申込を物理削除しても問い合わせは残し、entry_id だけ NULL にする（§5.10・B-01）
    foreignKey({
      name: "contact_messages_entry_fk",
      columns: [t.associationId, t.entryId],
      foreignColumns: [entries.associationId, entries.id],
    }),
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
