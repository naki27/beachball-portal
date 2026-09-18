import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { associations } from "./associations";
import { citext } from "./columns";
import { members } from "./members";
import { users } from "./users";

export type TeamKind = "team" | "individual";
export type TeamStatus = "active" | "inactive";

// チーム。individual は個人登録（§5.11）
export const teams = pgTable(
  "teams",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid()
      .notNull()
      .references(() => associations.id),
    kind: text().$type<TeamKind>().notNull().default("team"),
    name: text().notNull(),
    kana: text(),
    contactEmail: text(),
    contactPhone: text(),
    membershipRenewalTarget: boolean().notNull().default(false), // 協会員の登録をするチーム（年度更新の対象・§5.11）。個人登録は true
    status: text().$type<TeamStatus>().notNull().default("active"),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    unique("teams_association_id_id_unique").on(t.associationId, t.id),
    check("teams_kind_check", sql`${t.kind} in ('team', 'individual')`),
    check("teams_status_check", sql`${t.status} in ('active', 'inactive')`),
    // 個人登録は 1 協会につき 1 人 1 つ【仮】
    uniqueIndex("teams_individual_uk")
      .on(t.associationId, t.createdBy)
      .where(sql`${t.kind} = 'individual' and ${t.deletedAt} is null`),
  ],
);

// チーム名簿（人物の所属）。代表者は team_admins、本人のアカウントは members.user_id（§5.15）
export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    teamId: uuid().notNull(),
    memberId: uuid().notNull(),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp({ withTimezone: true }), // 選手一覧から外した（脱退。削除とは別）
    leftBy: uuid().references(() => users.id), // 外した代表者。直後の「元に戻す」はこの人だけ（§5.11）
    deletedAt: timestamp({ withTimezone: true }), // 論理削除（誤登録の取り消し）。テナント管理者だけが入れる（§5.11）
    deletedBy: uuid().references(() => users.id),
  },
  (t) => [
    foreignKey({
      name: "team_members_team_fk",
      columns: [t.associationId, t.teamId],
      foreignColumns: [teams.associationId, teams.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_members_member_fk",
      columns: [t.associationId, t.memberId],
      foreignColumns: [members.associationId, members.id],
    }).onDelete("cascade"),
    index("team_members_team_idx").on(t.teamId, t.leftAt).where(sql`${t.deletedAt} is null`),
    index("team_members_member_idx").on(t.memberId).where(sql`${t.deletedAt} is null`),
    uniqueIndex("team_members_active_uk")
      .on(t.teamId, t.memberId)
      .where(sql`${t.leftAt} is null and ${t.deletedAt} is null`),
  ],
);

// チームの代表者（アカウント × チーム・§3.1・§5.11）
export const teamAdmins = pgTable(
  "team_admins",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    teamId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    grantedBy: uuid().references(() => users.id), // NULL = チームを登録した本人。以後は委譲した代表者
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }), // 解除（最後の 1 人は解除不可をアプリで検査）
  },
  (t) => [
    foreignKey({
      name: "team_admins_team_fk",
      columns: [t.associationId, t.teamId],
      foreignColumns: [teams.associationId, teams.id],
    }).onDelete("cascade"),
    uniqueIndex("team_admins_active_uk").on(t.teamId, t.userId).where(sql`${t.revokedAt} is null`),
    index("team_admins_user_idx").on(t.userId).where(sql`${t.revokedAt} is null`),
  ],
);

export type TeamInvitationKind = "player" | "admin";
export type TeamInvitationStatus = "pending" | "accepted" | "rejected" | "cancelled" | "expired";

// 招待（選手として / 代表者として・§5.15）
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    associationId: uuid().notNull(),
    teamId: uuid().notNull(),
    kind: text().$type<TeamInvitationKind>().notNull(),
    memberId: uuid(), // kind = player のとき必須
    email: citext().notNull(),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id),
    status: text().$type<TeamInvitationStatus>().notNull().default("pending"),
    expiresAt: timestamp({ withTimezone: true }).notNull(), // 招待（再送）+ 3 日
    respondedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("team_invitations_kind_check", sql`${t.kind} in ('player', 'admin')`),
    check(
      "team_invitations_status_check",
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'cancelled', 'expired')`,
    ),
    check("team_invitations_member_id_check", sql`${t.kind} = 'admin' or ${t.memberId} is not null`),
    foreignKey({
      name: "team_invitations_team_fk",
      columns: [t.associationId, t.teamId],
      foreignColumns: [teams.associationId, teams.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_invitations_member_fk",
      columns: [t.associationId, t.memberId],
      foreignColumns: [members.associationId, members.id],
    }).onDelete("cascade"),
    index("team_invitations_email_idx").on(t.email).where(sql`${t.status} = 'pending'`),
    // 返事待ちの招待を重ねない（§5.15）
    uniqueIndex("team_invitations_player_pending_uk")
      .on(t.associationId, t.memberId)
      .where(sql`${t.kind} = 'player' and ${t.status} = 'pending'`),
    uniqueIndex("team_invitations_admin_pending_uk")
      .on(t.teamId, t.email)
      .where(sql`${t.kind} = 'admin' and ${t.status} = 'pending'`),
  ],
);
