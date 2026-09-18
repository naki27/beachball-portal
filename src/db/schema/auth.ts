import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { citext } from "./columns";
import { users } from "./users";

// セッション（§9.2）。期限切れは日次ジョブが物理削除する（論理削除の列は持たない・§5.16）
export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionHash: text().notNull().unique("sessions_session_hash_unique"), // SHA-256(session id)
    expiresAt: timestamp({ withTimezone: true }).notNull(), // スライディング: アクセス時に now + 10 日へ延長
    absoluteExpiresAt: timestamp({ withTimezone: true }).notNull(), // 発行 + 90 日（延長の上限）
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(), // テナント管理者だけは 1 分に 1 回まで更新（同時ログインの制限・§9.2）
    mfaVerifiedAt: timestamp({ withTimezone: true }), // 2 段階目を確認した時刻（§9.4・P1）
    enteredAssociationId: uuid().references(() => associations.id), // 運営管理者が切り替えて入った協会（§5.14）
    enteredUntil: timestamp({ withTimezone: true }), // 入った状態の期限
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export type LoginCodePurpose = "login" | "email_change";

// メール確認番号（§9）。users はまだ存在しないことがある（確認番号の入力に成功するまで作らない）ため、メールアドレスで持つ
export const loginCodes = pgTable(
  "login_codes",
  {
    id: uuid().primaryKey().defaultRandom(),
    purpose: text().$type<LoginCodePurpose>().notNull().default("login"), // email_change はメールアドレスの変更（§5.19）
    userId: uuid().references(() => users.id, { onDelete: "cascade" }), // purpose = email_change のとき必須
    email: citext().notNull(), // email_change では新しいアドレス
    attemptHash: text().notNull(), // SHA-256(試行 ID)。試行 ID は発行したブラウザの Cookie にだけある（§9.2）
    codeHash: text().notNull(), // HMAC-SHA-256(LOGIN_CODE_HMAC_KEY, 試行 ID || code)。6 桁は総当たり可能なので鍵付き
    expiresAt: timestamp({ withTimezone: true }).notNull(), // 発行 + 10 分
    attemptCount: integer().notNull().default(0), // 間違えた回数（試行の合計で 5 回まで・アプリで検査）
    usedAt: timestamp({ withTimezone: true }), // ワンタイム
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("login_codes_purpose_check", sql`${t.purpose} in ('login', 'email_change')`),
    check("login_codes_user_id_check", sql`${t.purpose} = 'login' or ${t.userId} is not null`),
    index("login_codes_attempt_idx").on(t.attemptHash, t.createdAt.desc()),
    index("login_codes_email_idx").on(t.email, t.createdAt.desc()),
  ],
);

// レート制限の回数（§9.2）。複数インスタンスで共有するため DB に置く。古い行は日次ジョブで削除
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().notNull(), // 例: login_request:email:<sha256>, login_verify:ip:<ip>, suggest:user:<id>
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
