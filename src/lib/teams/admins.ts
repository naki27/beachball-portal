import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { teamAdmins, users } from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import { normalizeEmail } from "@/lib/auth/login-input";
import type { Principal } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import { findMember } from "@/lib/repo/members";
import { findReusableTeamInvitation, insertTeamInvitation, listTeamInvitations, type TeamInvitationRow, updateTeamInvitation } from "@/lib/repo/team-invitations";
import { findActiveTeamMember, listLinkedRoster } from "@/lib/repo/team-members";
import { listTeamAdmins, type TeamAdminRow } from "@/lib/repo/teams";
import { authorizeTeam } from "./access";
import { TeamError } from "./errors";
import { teamInvitationExpiresFrom } from "./invitations";

// 代表者の委譲（追加）と解除（設計書 §5.11「名簿の管理」の「代表者の委譲」・§5.15）
// 追加は「選手として紐づいている人」から選ぶか、メールアドレスで代表者として招待する。どちらも本人が承諾して初めて代表者になる
// 解除は代表者どうしで行える。最後の 1 人は外せない（自分で降りることもできない）

export type TeamAdminsView = {
  admins: TeamAdminRow[];
  // 返事待ち（期限切れを含む）の代表者としての招待
  invitations: { invitationId: string; email: string; expiresAt: string; expired: boolean }[];
  // 代表者として招待できる、選手として紐づいている人（まだ代表者でない）
  candidates: { memberId: string; name: string }[];
};

async function sendAdminInvitation(tx: Tx, associationId: string, invitation: { id: string; email: string }): Promise<void> {
  await enqueueMail(tx, { associationId, mailType: "team_invitation", toEmail: invitation.email, params: { invitationId: invitation.id } });
}

function invitationView(row: TeamInvitationRow, now: Date) {
  return {
    invitationId: row.id,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
    expired: row.status === "expired" || row.expiresAt.getTime() <= now.getTime(),
  };
}

// 代表者の画面に出すもの（代表者・テナント管理者）
export async function getTeamAdmins(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  now = new Date(),
): Promise<TeamAdminsView> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeTeam(tx, principal, associationId, teamId, "manageTeamAdmins");
      const admins = await listTeamAdmins(tx, associationId, teamId);
      const invitations = (await listTeamInvitations(tx, associationId, teamId, ["pending", "expired"]))
        .filter((i) => i.kind === "admin")
        .map((i) => invitationView(i, now));
      const adminUserIds = new Set(admins.map((a) => a.userId));
      const candidates = (await listLinkedRoster(tx, associationId, teamId))
        .filter((c) => !adminUserIds.has(c.userId))
        .map((c) => ({ memberId: c.memberId, name: c.name }));
      return { admins, invitations, candidates };
    },
    { userId: principal.userId },
  );
}

// 代表者として招待する。{ email } か { memberId }（選手として紐づいている人。その人のログインのアドレスに送る）
export async function inviteAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  raw: { memberId?: unknown; email?: unknown },
  now: Date = new Date(),
): Promise<{ invitationId: string; resent: boolean; expiresAt: string }> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "manageTeamAdmins");
      if (team.kind === "individual") throw new TeamError(409, "個人の登録では代表者を追加できません");
      if (team.status !== "active") throw new TeamError(409, "このチームは無効になっているので招待できません");

      let email: string | null = null;
      if (typeof raw.memberId === "string") {
        if (!isUuid(raw.memberId) || !(await findActiveTeamMember(tx, associationId, teamId, raw.memberId))) {
          throw new TeamError(404, "選手が見つかりません");
        }
        const member = await findMember(tx, associationId, raw.memberId);
        if (!member?.userId) throw new TeamError(409, "この方はまだログインできる状態ではありません。メールアドレスで招待してください");
        const [u] = await tx.select({ email: users.email }).from(users).where(and(eq(users.id, member.userId), isNull(users.deletedAt))).limit(1);
        email = u?.email ?? null;
      } else if (typeof raw.email === "string") {
        email = normalizeEmail(raw.email);
      }
      if (!email) throw new TeamError(400, "メールアドレスの形で入力してください", { field: "email" });

      const admins = await listTeamAdmins(tx, associationId, teamId);
      if (admins.some((a) => a.email.toLowerCase() === email.toLowerCase())) throw new TeamError(409, "この方はすでに代表者です");

      const expiresAt = teamInvitationExpiresFrom(now);
      const reusable = await findReusableTeamInvitation(tx, associationId, teamId, { kind: "admin", email });
      if (reusable) {
        await updateTeamInvitation(tx, associationId, reusable.id, { status: "pending", expiresAt, respondedAt: null });
        await sendAdminInvitation(tx, associationId, { id: reusable.id, email });
        return { invitationId: reusable.id, resent: true, expiresAt: expiresAt.toISOString() };
      }
      const id = crypto.randomUUID();
      await insertTeamInvitation(tx, associationId, { id, teamId, kind: "admin", memberId: null, email, invitedBy: principal.userId, expiresAt });
      await sendAdminInvitation(tx, associationId, { id, email });
      return { invitationId: id, resent: false, expiresAt: expiresAt.toISOString() };
    },
    { userId: principal.userId },
  );
}

// 代表者の解除（自分で降りるのも同じ）。最後の 1 人は外せない（409）
export async function revokeTeamAdmin(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(userId)) throw new TeamError(404, "代表者が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeTeam(tx, principal, associationId, teamId, "manageTeamAdmins");
      const admins = await listTeamAdmins(tx, associationId, teamId);
      if (!admins.some((a) => a.userId === userId)) throw new TeamError(404, "代表者が見つかりません");
      if (admins.length <= 1) throw new TeamError(409, "最後の代表者は外せません。先にほかの人を代表者に加えてください");
      await tx
        .update(teamAdmins)
        .set({ revokedAt: now })
        .where(and(eq(teamAdmins.associationId, associationId), eq(teamAdmins.teamId, teamId), eq(teamAdmins.userId, userId), isNull(teamAdmins.revokedAt)));
    },
    { userId: principal.userId },
  );
}
