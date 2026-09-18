import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { users } from "./users";

// 管理者の重要操作・運営管理者のテナント切り替えの記録（§5.14・§9.4）。個人情報は入れない
export const adminAccessLogs = pgTable(
  "admin_access_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    associationId: uuid().references(() => associations.id),
    // enter_tenant | leave_tenant | physical_delete | invite_admin | accept_admin | revoke_admin | merge_members |
    // import_memberships | change_slug | create_association |（P1）reset_2fa | mfa_changed | mfa_reverify
    action: text().notNull(),
    targetId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_access_logs_idx").on(t.associationId, t.createdAt.desc())],
);

// 物理削除の記録（§5.16）。消した中身は持たない。この表は日次ジョブでも消さない
export const deletionLogs = pgTable("deletion_logs", {
  id: uuid().primaryKey().defaultRandom(),
  associationId: uuid().references(() => associations.id),
  tableName: text().notNull(),
  recordId: uuid().notNull(),
  cascadedCount: integer().notNull().default(0), // 一緒に消えた行の数
  reason: text(), // 保存期間満了 / 本人からの依頼 / 誤登録 など
  deletedBy: uuid()
    .notNull()
    .references(() => users.id),
  deletedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type MailStatus = "queued" | "sent" | "failed" | "bounced";

// メールの送信記録と送信待ちの表を兼ねる（§11）
export const mailLogs = pgTable(
  "mail_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().references(() => associations.id), // 確認番号など協会に属さないメールは NULL
    mailType: text().notNull(),
    toEmail: text().notNull(),
    userId: uuid().references(() => users.id),
    entryId: uuid(), // entries への外部キー（on delete set null）は entries を作る B-01 で足す
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}), // 本文を組み立てるための ID だけ（本文・生年月日は入れない）
    status: text().$type<MailStatus>().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    providerMessageId: text(),
    error: text(), // 個人情報を含めない
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("mail_logs_status_check", sql`${t.status} in ('queued', 'sent', 'failed', 'bounced')`),
    index("mail_logs_queue_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'queued'`),
    index("mail_logs_daily_idx").on(t.sentAt).where(sql`${t.status} = 'sent'`), // 1 日の送信数（§11.2）
  ],
);
