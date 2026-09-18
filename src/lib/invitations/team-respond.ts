import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { associations, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { findMember, findMemberByUserId, setMemberUser, updateMemberStatus } from "@/lib/repo/members";
import { listMyPendingInvitations, type MyInvitation } from "@/lib/repo/invitations";
import { lockTeamInvitation, type TeamInvitationRow, updateTeamInvitation } from "@/lib/repo/team-invitations";
import { listTeamNamesOfMember } from "@/lib/repo/team-members";
import { addTeamAdmin, findTeam, isActiveTeamAdmin } from "@/lib/repo/teams";
import { notifyTeamAdmins } from "@/lib/teams/invitations";
import { InvitationError } from "./admin-accept";

// 選手・代表者としての招待への返事（設計書 §5.15）。本人の操作
// 承諾の時点で前提をもう一度確かめる: 招待が pending で期限内か、人物が削除されていないか、人物にまだ誰も紐づいていないか、
// チームが削除されていないか、ログイン中のアカウントの確認済みメールアドレスが招待のアドレスと一致するか
// 同じ協会で自分のアカウントがすでに別の人物に紐づいていれば、承諾させず、招待の人物を要確認にする（人物の重複の疑い）

export type TeamInvitationAccepted = { redirectTo: string; teamName: string; associationName: string };

async function findMyTeamInvitation(db: Db, userId: string, invitationId: string): Promise<{ mine: MyInvitation; associationId: string }> {
  const mine = (await listMyPendingInvitations(db, userId)).find((i) => i.invitationId === invitationId);
  if (!mine || mine.kind === "association_admin") {
    throw new InvitationError(404, "招待が見つかりません（期限が切れたか、別のアドレスでログインしています）");
  }
  const [association] = await db.select({ id: associations.id }).from(associations).where(eq(associations.slug, mine.associationSlug)).limit(1);
  if (!association) throw new InvitationError(404, "協会がありません");
  return { mine, associationId: association.id };
}

async function verifiedEmailOf(db: Db, userId: string): Promise<string> {
  const [me] = await db.select({ email: users.email, verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!me?.verifiedAt) throw new InvitationError(409, "メールアドレスの確認が済んでいません");
  return me.email;
}

function assertOpen(row: TeamInvitationRow | null, now: Date): asserts row is TeamInvitationRow {
  if (!row || row.status !== "pending" || row.expiresAt.getTime() <= now.getTime()) {
    throw new InvitationError(409, "この招待は期限が切れたか、すでに返事が済んでいます");
  }
}

export async function acceptTeamInvitation(db: Db, userId: string, invitationId: string, now: Date = new Date()): Promise<TeamInvitationAccepted> {
  const { mine, associationId } = await findMyTeamInvitation(db, userId, invitationId);
  const myEmail = await verifiedEmailOf(db, userId);

  // 承諾できない理由のうち「要確認にする」ものは、その更新を確定させてから返す（例外で巻き戻さない）
  const outcome = await withTenantOn(
    db,
    associationId,
    async (tx): Promise<{ ok: true; redirectTo: string } | { ok: false; message: string }> => {
      const row = await lockTeamInvitation(tx, associationId, invitationId);
      assertOpen(row, now);
      if (row.email.toLowerCase() !== myEmail.toLowerCase()) throw new InvitationError(409, "招待のメールを受け取ったアドレスでログインしてください");
      const team = await findTeam(tx, associationId, row.teamId);
      if (!team) throw new InvitationError(409, "このチームはなくなっています");
      if (team.status !== "active") throw new InvitationError(409, "このチームは無効になっています");

      if (row.kind === "admin") {
        // 代表者としての招待（§5.11「代表者の委譲」）: 承諾で team_admins に行が入る。委譲した人を granted_by に記録
        if (!(await isActiveTeamAdmin(tx, associationId, team.id, userId))) {
          await addTeamAdmin(tx, associationId, team.id, userId, row.invitedBy);
        }
        await updateTeamInvitation(tx, associationId, row.id, { status: "accepted", respondedAt: now });
        await notifyTeamAdmins(tx, associationId, team.id, row.invitedBy, "team_invitation_accepted", { invitationId: row.id });
        return { ok: true, redirectTo: `/${mine.associationSlug}/teams/${team.id}` };
      }

      const member = row.memberId ? await findMember(tx, associationId, row.memberId) : null;
      if (!member || member.status === "merged") throw new InvitationError(409, "この登録はなくなっています");
      if (member.userId && member.userId !== userId) throw new InvitationError(409, "この方はすでに別のアカウントでログインできる状態です");
      const linked = await findMemberByUserId(tx, associationId, userId);
      if (linked && linked.id !== member.id) {
        // 同じ協会で 1 アカウント = 1 人物。人物の重複の疑いとして運営が確かめる（§5.15・§5.8）
        await updateMemberStatus(tx, associationId, member.id, "needs_review");
        const teamNames = await listTeamNamesOfMember(tx, associationId, linked.id);
        const where = teamNames.length > 0 ? `・${teamNames[0]}` : "";
        return { ok: false, message: `すでに別の登録（${linked.name}${where}）と結びついています。協会の管理者が確認します` };
      }
      if (!member.userId) await setMemberUser(tx, associationId, member.id, userId);
      await updateTeamInvitation(tx, associationId, row.id, { status: "accepted", respondedAt: now });
      await notifyTeamAdmins(tx, associationId, team.id, row.invitedBy, "team_invitation_accepted", { invitationId: row.id });
      return { ok: true, redirectTo: `/${mine.associationSlug}/teams/${team.id}/members` };
    },
    { userId },
  );
  if (!outcome.ok) throw new InvitationError(409, outcome.message);
  return { redirectTo: outcome.redirectTo, teamName: mine.teamName ?? "", associationName: mine.associationName };
}

// 「心当たりがない」。招待を無効にし、招待した代表者に「メールアドレスを確かめてください」と知らせる
export async function rejectTeamInvitation(db: Db, userId: string, invitationId: string, now: Date = new Date()): Promise<void> {
  const { associationId } = await findMyTeamInvitation(db, userId, invitationId);
  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      const row = await lockTeamInvitation(tx, associationId, invitationId);
      assertOpen(row, now);
      await updateTeamInvitation(tx, associationId, row.id, { status: "rejected", respondedAt: now });
      await notifyTeamAdmins(tx, associationId, row.teamId, row.invitedBy, "team_invitation_rejected", { invitationId: row.id });
    },
    { userId },
  );
}
