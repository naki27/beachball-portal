import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { associationAdminInvitations, associationAdmins, sessions, users } from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import { normalizeEmail } from "@/lib/auth/login-input";
import { enqueueMail } from "@/lib/mail/outbox";
import { logAdminAccess } from "@/lib/repo/admin-access-logs";
import { ADMIN_INVITATION_DAYS, MAX_ADMINS_PER_ASSOCIATION, PlatformError } from "./associations";

// テナント管理者の招待・再送・取り消し・解除（設計書 §5.14「テナント管理者の招待」）。運営管理者だけが行う（呼ぶ側で検査）
// 招待のメールは送信待ちに積む（§11）。承諾は本人の操作（src/lib/invitations/admin-accept.ts）

export type AdminInvitationRow = typeof associationAdminInvitations.$inferSelect;

function expiresFrom(now: Date): Date {
  return new Date(now.getTime() + ADMIN_INVITATION_DAYS * 24 * 60 * 60 * 1000);
}

export async function listAdminInvitations(db: Db, actorUserId: string, associationId: string): Promise<AdminInvitationRow[]> {
  return withTenantOn(
    db,
    associationId,
    (tx) =>
      tx
        .select()
        .from(associationAdminInvitations)
        .where(eq(associationAdminInvitations.associationId, associationId))
        .orderBy(desc(associationAdminInvitations.createdAt)),
    { userId: actorUserId },
  );
}

// 管理者と返事待ちの招待を合わせて 5 名まで（§5.14）
async function countAdminsAndPending(tx: Tx, associationId: string, now: Date): Promise<{ admins: number; pending: number }> {
  const admins = await tx.select({ userId: associationAdmins.userId }).from(associationAdmins).where(eq(associationAdmins.associationId, associationId));
  const pending = await tx
    .select({ id: associationAdminInvitations.id })
    .from(associationAdminInvitations)
    .where(
      and(
        eq(associationAdminInvitations.associationId, associationId),
        eq(associationAdminInvitations.status, "pending"),
        gt(associationAdminInvitations.expiresAt, now),
      ),
    );
  return { admins: admins.length, pending: pending.length };
}

async function sendInvitation(tx: Tx, associationId: string, invitation: { id: string; email: string }): Promise<void> {
  await enqueueMail(tx, {
    associationId,
    mailType: "association_admin_invitation",
    toEmail: invitation.email,
    params: { invitationId: invitation.id },
  });
}

// 招待する。同じアドレスに返事待ち（または期限切れ）の招待があれば、その行を再送する（返事待ちは重ねない・§5.15）
export async function inviteAssociationAdmin(
  db: Db,
  actorUserId: string,
  associationId: string,
  emailRaw: string,
  now: Date = new Date(),
): Promise<{ invitationId: string; resent: boolean }> {
  const email = normalizeEmail(emailRaw);
  if (!email) throw new PlatformError(400, "メールアドレスの形で入力してください", "email");

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      // すでにこの協会の管理者なら招待しない
      const [existingAdmin] = await tx
        .select({ userId: associationAdmins.userId })
        .from(associationAdmins)
        .innerJoin(users, eq(users.id, associationAdmins.userId))
        .where(and(eq(associationAdmins.associationId, associationId), eq(users.email, email), isNull(users.deletedAt)))
        .limit(1);
      if (existingAdmin) throw new PlatformError(409, "すでにこの協会の管理者です", "email");

      const [open] = await tx
        .select()
        .from(associationAdminInvitations)
        .where(
          and(
            eq(associationAdminInvitations.associationId, associationId),
            eq(associationAdminInvitations.email, email),
            inArray(associationAdminInvitations.status, ["pending", "expired"]),
          ),
        )
        .limit(1);
      if (open) {
        await tx
          .update(associationAdminInvitations)
          .set({ status: "pending", expiresAt: expiresFrom(now), respondedAt: null })
          .where(eq(associationAdminInvitations.id, open.id));
        await sendInvitation(tx, associationId, { id: open.id, email });
        await logAdminAccess(tx, { userId: actorUserId, associationId, action: "invite_admin", targetId: open.id });
        return { invitationId: open.id, resent: true };
      }

      const { admins, pending } = await countAdminsAndPending(tx, associationId, now);
      if (admins + pending >= MAX_ADMINS_PER_ASSOCIATION) {
        throw new PlatformError(
          409,
          `管理者と返事待ちの招待が合わせて ${MAX_ADMINS_PER_ASSOCIATION} 名に達しているので、これ以上招待できません`,
          "email",
        );
      }

      const id = crypto.randomUUID();
      await tx.insert(associationAdminInvitations).values({
        id,
        associationId,
        email,
        invitedBy: actorUserId,
        expiresAt: expiresFrom(now),
      });
      await sendInvitation(tx, associationId, { id, email });
      await logAdminAccess(tx, { userId: actorUserId, associationId, action: "invite_admin", targetId: id });
      return { invitationId: id, resent: false };
    },
    { userId: actorUserId },
  );
}

// 再送: 同じ行の期限を延ばし（期限切れなら返事待ちに戻し）、メールをもう一度送る。承諾・拒否・取り消し済みは再送しない
export async function resendAdminInvitation(
  db: Db,
  actorUserId: string,
  associationId: string,
  invitationId: string,
  now: Date = new Date(),
): Promise<void> {
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      const [row] = await tx
        .select()
        .from(associationAdminInvitations)
        .where(and(eq(associationAdminInvitations.id, invitationId), eq(associationAdminInvitations.associationId, associationId)))
        .limit(1);
      if (!row) throw new PlatformError(400, "招待がありません");
      if (row.status !== "pending" && row.status !== "expired") throw new PlatformError(409, "この招待は再送できません（新しく招待してください）");
      await tx
        .update(associationAdminInvitations)
        .set({ status: "pending", expiresAt: expiresFrom(now), respondedAt: null })
        .where(eq(associationAdminInvitations.id, invitationId));
      await sendInvitation(tx, associationId, { id: row.id, email: row.email });
      await logAdminAccess(tx, { userId: actorUserId, associationId, action: "invite_admin", targetId: invitationId });
    },
    { userId: actorUserId },
  );
}

export async function cancelAdminInvitation(db: Db, actorUserId: string, associationId: string, invitationId: string, now: Date = new Date()): Promise<void> {
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      const rows = await tx
        .update(associationAdminInvitations)
        .set({ status: "cancelled", respondedAt: now })
        .where(
          and(
            eq(associationAdminInvitations.id, invitationId),
            eq(associationAdminInvitations.associationId, associationId),
            inArray(associationAdminInvitations.status, ["pending", "expired"]),
          ),
        )
        .returning({ id: associationAdminInvitations.id });
      if (rows.length === 0) throw new PlatformError(409, "この招待は取り消せません");
    },
    { userId: actorUserId },
  );
}

// テナント管理者の解除（§5.14）。そのユーザーの「入っている協会」と 2 段階目の確認（P1）をセッションから消す（§9.2）
export async function removeAssociationAdmin(db: Db, actorUserId: string, associationId: string, userId: string): Promise<void> {
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      const rows = await tx
        .delete(associationAdmins)
        .where(and(eq(associationAdmins.associationId, associationId), eq(associationAdmins.userId, userId)))
        .returning({ userId: associationAdmins.userId });
      if (rows.length === 0) throw new PlatformError(400, "その人はこの協会の管理者ではありません");
      await tx.update(sessions).set({ enteredAssociationId: null, enteredUntil: null, mfaVerifiedAt: null }).where(eq(sessions.userId, userId));
      await logAdminAccess(tx, { userId: actorUserId, associationId, action: "revoke_admin", targetId: userId });
    },
    { userId: actorUserId },
  );
}
