import type { Db } from "@/db/client";
import { listMyPendingInvitations } from "@/lib/repo/invitations";
import { acceptAdminInvitation, InvitationError, rejectAdminInvitation } from "./admin-accept";
import { acceptTeamInvitation, rejectTeamInvitation } from "./team-respond";

// 招待への返事の入口（/api/me/invitations/[id]/accept|reject）。種別で振り分ける
// association_admin = テナント管理者（§5.14）／ player・admin = チームの選手・代表者（§5.15）

export type RespondResult = { redirectTo: string; message: string };

export async function respondToInvitation(
  db: Db,
  userId: string,
  sessionId: string,
  invitationId: string,
  action: "accept" | "reject",
): Promise<RespondResult> {
  const mine = (await listMyPendingInvitations(db, userId)).find((i) => i.invitationId === invitationId);
  if (!mine) throw new InvitationError(404, "招待が見つかりません（期限が切れたか、別のアドレスでログインしています）");

  if (mine.kind === "association_admin") {
    if (action === "accept") {
      const result = await acceptAdminInvitation(db, userId, sessionId, invitationId);
      return { redirectTo: `/${result.associationSlug}/admin`, message: `${result.associationName}の管理者になりました` };
    }
    await rejectAdminInvitation(db, userId, invitationId);
    return { redirectTo: "/invitations", message: "招待を無効にし、招待した人に知らせました" };
  }

  if (action === "accept") {
    const result = await acceptTeamInvitation(db, userId, invitationId);
    return { redirectTo: result.redirectTo, message: `${result.teamName}に参加しました` };
  }
  await rejectTeamInvitation(db, userId, invitationId);
  return { redirectTo: "/invitations", message: "招待を無効にし、招待した人に知らせました" };
}
