import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { teamAdmins, users } from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import { normalizeEmail } from "@/lib/auth/login-input";
import type { Principal } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import type { MailType } from "@/lib/mail/types";
import { findMember } from "@/lib/repo/members";
import {
  findPendingPlayerInvitation,
  findReusableTeamInvitation,
  findTeamInvitation,
  insertTeamInvitation,
  updateTeamInvitation,
} from "@/lib/repo/team-invitations";
import { findActiveTeamMember } from "@/lib/repo/team-members";
import type { Team } from "@/lib/repo/teams";
import { authorizeTeam } from "./access";
import { TeamError } from "./errors";

// 選手・代表者としての招待の作成・再送・取り消し（設計書 §5.15「選手のアカウントとの紐づけ（招待）」・§5.11「代表者の委譲」）
// 代表者の操作。返事（承諾・「心当たりがない」）は本人の操作（src/lib/invitations/team-respond.ts）
// 招待メールは送信待ちに積む（§11）。本文にログイン用のリンクは載せない（§9.3）

// 招待の有効期限（§5.15・3 日）
export const TEAM_INVITATION_DAYS = 3;

export function teamInvitationExpiresFrom(now: Date): Date {
  return new Date(now.getTime() + TEAM_INVITATION_DAYS * 24 * 60 * 60 * 1000);
}

function requireInvitationId(invitationId: string): void {
  if (!isUuid(invitationId)) throw new TeamError(404, "招待が見つかりません");
}

// 無効化・削除したチームでは招待しない（§5.11「チームの無効化と削除」）
function assertTeamCanInvite(team: Team): void {
  if (team.status !== "active") throw new TeamError(409, "このチームは無効になっているので招待できません");
}

async function sendTeamInvitation(tx: Tx, associationId: string, invitation: { id: string; email: string }): Promise<void> {
  await enqueueMail(tx, { associationId, mailType: "team_invitation", toEmail: invitation.email, params: { invitationId: invitation.id } });
}

// 招待した代表者に知らせる。その人がもう代表者でなければ、そのチームの有効な代表者全員に（§5.15）
export async function notifyTeamAdmins(
  tx: Tx,
  associationId: string,
  teamId: string,
  invitedBy: string,
  mailType: Extract<MailType, "team_invitation_accepted" | "team_invitation_rejected" | "team_invitation_expired">,
  params: Record<string, unknown>,
): Promise<void> {
  const admins = await tx
    .select({ userId: teamAdmins.userId, email: users.email })
    .from(teamAdmins)
    .innerJoin(users, and(eq(users.id, teamAdmins.userId), isNull(users.deletedAt)))
    .where(and(eq(teamAdmins.associationId, associationId), eq(teamAdmins.teamId, teamId), isNull(teamAdmins.revokedAt)));
  const inviter = admins.find((a) => a.userId === invitedBy);
  const recipients = inviter ? [inviter] : admins;
  for (const r of recipients) {
    await enqueueMail(tx, { associationId, mailType, toEmail: r.email, userId: r.userId, params });
  }
}

export type InviteResult = { invitationId: string; resent: boolean; expiresAt: string };

// 選手として招待する（代表者）。選手一覧にいる人物に、本人のメールアドレスを入れて送る
// 同じチームからの返事待ち・期限切れの招待があれば同じ行を再送する。別のチームからの返事待ちがあれば 409（重ねない・§5.15）
export async function invitePlayer(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  raw: { memberId?: unknown; email?: unknown },
  now: Date = new Date(),
): Promise<InviteResult> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      if (team.kind === "individual") throw new TeamError(409, "個人の登録では招待できません");
      assertTeamCanInvite(team);
      const memberId = typeof raw.memberId === "string" && isUuid(raw.memberId) ? raw.memberId : null;
      if (!memberId || !(await findActiveTeamMember(tx, associationId, teamId, memberId))) throw new TeamError(404, "選手が見つかりません");
      const member = await findMember(tx, associationId, memberId);
      if (!member || member.status === "merged") throw new TeamError(404, "選手が見つかりません");
      if (member.userId) throw new TeamError(409, "この方はすでにログインできる状態です");
      const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : null;
      if (!email) throw new TeamError(400, "メールアドレスの形で入力してください", { field: "email" });

      const reusable = await findReusableTeamInvitation(tx, associationId, teamId, { kind: "player", memberId });
      const elsewhere = await findPendingPlayerInvitation(tx, associationId, memberId, now);
      if (elsewhere && elsewhere.id !== reusable?.id) throw new TeamError(409, "この方には別の招待が届いています");

      const expiresAt = teamInvitationExpiresFrom(now);
      if (reusable) {
        await updateTeamInvitation(tx, associationId, reusable.id, { status: "pending", email, expiresAt, respondedAt: null });
        await sendTeamInvitation(tx, associationId, { id: reusable.id, email });
        return { invitationId: reusable.id, resent: true, expiresAt: expiresAt.toISOString() };
      }
      const id = crypto.randomUUID();
      await insertTeamInvitation(tx, associationId, { id, teamId, kind: "player", memberId, email, invitedBy: principal.userId, expiresAt });
      await sendTeamInvitation(tx, associationId, { id, email });
      return { invitationId: id, resent: false, expiresAt: expiresAt.toISOString() };
    },
    { userId: principal.userId },
  );
}

// 再送: 同じ行の期限を「今 + 3 日」にし（期限切れなら返事待ちに戻し）、メールをもう一度送る。承諾・拒否・取り消し済みは 409
export async function resendTeamInvitation(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  invitationId: string,
  now: Date = new Date(),
): Promise<InviteResult> {
  requireInvitationId(invitationId);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      assertTeamCanInvite(team);
      const row = await findTeamInvitation(tx, associationId, invitationId);
      if (!row || row.teamId !== teamId) throw new TeamError(404, "招待が見つかりません");
      if (row.status !== "pending" && row.status !== "expired") throw new TeamError(409, "この招待は再送できません（新しく招待してください）");
      const expiresAt = teamInvitationExpiresFrom(now);
      await updateTeamInvitation(tx, associationId, row.id, { status: "pending", expiresAt, respondedAt: null });
      await sendTeamInvitation(tx, associationId, { id: row.id, email: row.email });
      return { invitationId: row.id, resent: true, expiresAt: expiresAt.toISOString() };
    },
    { userId: principal.userId },
  );
}

// 取り消し（返事待ち・期限切れだけ）
export async function cancelTeamInvitation(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  invitationId: string,
  now: Date = new Date(),
): Promise<void> {
  requireInvitationId(invitationId);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      const row = await findTeamInvitation(tx, associationId, invitationId);
      if (!row || row.teamId !== teamId) throw new TeamError(404, "招待が見つかりません");
      if (row.status !== "pending" && row.status !== "expired") throw new TeamError(409, "この招待は取り消せません");
      await updateTeamInvitation(tx, associationId, row.id, { status: "cancelled", respondedAt: now });
    },
    { userId: principal.userId },
  );
}
