import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { citext } from "./columns";
import { users } from "./users";

// 運営管理者（全テナント横断・§5.14）。seed スクリプトでのみ登録する。画面からは付与できない
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id),
  grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  note: text(),
  enrollCodeHash: text(), // seed が発行する登録用コード（HMAC）。初回の 2 段階認証の登録に必須（§5.14・P1）
  enrollCodeExpiresAt: timestamp({ withTimezone: true }), // 発行 + 24 時間（P1）
});

// 協会の管理者（テナントごとに持つ）
export const associationAdmins = pgTable(
  "association_admins",
  {
    associationId: uuid()
      .notNull()
      .references(() => associations.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid().references(() => users.id), // 招待した運営管理者（§5.14）
    mfaEnrollBy: timestamp({ withTimezone: true }), // この日時までに 2 段階認証を登録（承諾 + 7 日【仮】・§9.4・P1）
  },
  (t) => [primaryKey({ columns: [t.associationId, t.userId] })],
);

export type AdminInvitationStatus = "pending" | "accepted" | "rejected" | "cancelled" | "expired";

// テナント管理者の招待（§5.14）。運営管理者が招待し、本人が承諾すると association_admins に行が入る
export const associationAdminInvitations = pgTable(
  "association_admin_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid()
      .notNull()
      .references(() => associations.id, { onDelete: "cascade" }),
    email: citext().notNull(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id), // 運営管理者
    status: text().$type<AdminInvitationStatus>().notNull().default("pending"),
    expiresAt: timestamp({ withTimezone: true }).notNull(), // 招待（再送）+ 7 日【仮】
    respondedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "association_admin_invitations_status_check",
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')`,
    ),
    uniqueIndex("association_admin_invitations_pending_uk")
      .on(t.associationId, t.email)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// 旧スラッグからの転送（§5.14）
export const associationSlugHistory = pgTable("association_slug_history", {
  slug: text().primaryKey(),
  associationId: uuid()
    .notNull()
    .references(() => associations.id),
  replacedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
