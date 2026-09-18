import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { associationAdminInvitations, associationAdmins, associations, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { endUserSessions } from "@/lib/auth/session";
import { enqueueMail } from "@/lib/mail/outbox";
import { MAX_ADMINS_PER_ASSOCIATION } from "@/lib/platform/associations";
import { logAdminAccess } from "@/lib/repo/admin-access-logs";
import { listMyPendingInvitations } from "@/lib/repo/invitations";

// テナント管理者の招待への返事（設計書 §5.14「テナント管理者の招待」）。本人の操作
// 承諾の時点で、招待が期限内か、ログイン中のアカウントの確認済みメールアドレスが招待のアドレスと一致するか、
// 協会の管理者が 5 名に達していないかを確かめる。承諾したら、そのアカウントのほかのセッションを終了する（§9.2）

export class InvitationError extends Error {
  constructor(
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

async function findMyAdminInvitation(db: Db, userId: string, invitationId: string) {
  const mine = (await listMyPendingInvitations(db, userId)).find((i) => i.invitationId === invitationId);
  if (!mine || mine.kind !== "association_admin") throw new InvitationError(404, "招待が見つかりません（期限が切れたか、別のアドレスでログインしています）");
  const [association] = await db.select().from(associations).where(eq(associations.slug, mine.associationSlug)).limit(1);
  if (!association) throw new InvitationError(404, "協会がありません");
  return { mine, association };
}

export async function acceptAdminInvitation(
  db: Db,
  userId: string,
  sessionId: string,
  invitationId: string,
  now: Date = new Date(),
): Promise<{ associationSlug: string; associationName: string }> {
  const { association } = await findMyAdminInvitation(db, userId, invitationId);
  const [me] = await db.select({ email: users.email, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!me?.verifiedAt) throw new InvitationError(409, "メールアドレスの確認が済んでいません");

  await withTenantOn(
    db,
    association.id,
    async (tx) => {
      const [invitation] = await tx
        .select()
        .from(associationAdminInvitations)
        .where(and(eq(associationAdminInvitations.id, invitationId), eq(associationAdminInvitations.associationId, association.id)))
        .limit(1)
        .for("update");
      if (!invitation || invitation.status !== "pending" || invitation.expiresAt.getTime() <= now.getTime()) {
        throw new InvitationError(409, "この招待は期限が切れたか、すでに返事が済んでいます");
      }
      if (invitation.email.toLowerCase() !== me.email.toLowerCase()) {
        throw new InvitationError(409, "招待のメールを受け取ったアドレスでログインしてください");
      }
      const admins = await tx
        .select({ userId: associationAdmins.userId })
        .from(associationAdmins)
        .where(eq(associationAdmins.associationId, association.id));
      if (admins.some((a) => a.userId === userId)) throw new InvitationError(409, "すでにこの協会の管理者です");
      if (admins.length >= MAX_ADMINS_PER_ASSOCIATION) {
        throw new InvitationError(409, `この協会の管理者はすでに ${MAX_ADMINS_PER_ASSOCIATION} 名います`);
      }

      await tx.insert(associationAdmins).values({ associationId: association.id, userId, grantedBy: invitation.invitedBy });
      await tx
        .update(associationAdminInvitations)
        .set({ status: "accepted", respondedAt: now })
        .where(eq(associationAdminInvitations.id, invitationId));
      await logAdminAccess(tx, { userId, associationId: association.id, action: "accept_admin", targetId: invitationId });
    },
    { userId },
  );

  // テナント管理者は同時に 1 つまで: 承諾したセッション以外を終了する（§9.2）
  await endUserSessions(db, userId, { exceptSessionId: sessionId });
  return { associationSlug: association.slug, associationName: association.name };
}

// 「心当たりがない」。招待を無効にし、招待した運営管理者に知らせる
export async function rejectAdminInvitation(db: Db, userId: string, invitationId: string, now: Date = new Date()): Promise<void> {
  const { association } = await findMyAdminInvitation(db, userId, invitationId);
  await withTenantOn(
    db,
    association.id,
    async (tx) => {
      const rows = await tx
        .update(associationAdminInvitations)
        .set({ status: "rejected", respondedAt: now })
        .where(
          and(
            eq(associationAdminInvitations.id, invitationId),
            eq(associationAdminInvitations.associationId, association.id),
            eq(associationAdminInvitations.status, "pending"),
            gt(associationAdminInvitations.expiresAt, now),
          ),
        )
        .returning({ invitedBy: associationAdminInvitations.invitedBy });
      if (rows.length === 0) throw new InvitationError(409, "この招待は期限が切れたか、すでに返事が済んでいます");
      const [inviter] = await tx
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.id, rows[0].invitedBy), isNull(users.deletedAt)))
        .limit(1);
      if (inviter) {
        await enqueueMail(tx, {
          associationId: association.id,
          mailType: "association_admin_invitation_rejected",
          toEmail: inviter.email,
          userId: rows[0].invitedBy,
          params: { invitationId },
        });
      }
    },
    { userId },
  );
}
