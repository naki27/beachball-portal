import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Tx } from "@/db/tenant";

// ログイン中の人の返事待ちの招待（設計書 §5.14「協会をまたぐ画面」）。SECURITY DEFINER 関数 my_pending_invitations() で読む
// （確認済みのメールアドレス宛て・期限内の pending だけ。選手・代表者・テナント管理者の招待が混ざる）

export type MyInvitation = {
  invitationId: string;
  associationName: string;
  associationSlug: string;
  teamId: string | null;
  teamName: string | null;
  // player | admin（チーム）| association_admin（テナント管理者）
  kind: string;
  // 選手としての招待のときの人物の氏名（「選手（山田太郎）として」）
  memberName: string | null;
  inviterName: string | null;
  expiresAt: Date;
};

export async function listMyPendingInvitations(db: Db | Tx, userId: string): Promise<MyInvitation[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const result = await tx.execute<{
      invitation_id: string;
      association_name: string;
      association_slug: string;
      team_id: string | null;
      team_name: string | null;
      kind: string;
      member_name: string | null;
      inviter_name: string | null;
      expires_at: string | Date;
    }>(sql`select * from my_pending_invitations()`);
    return result.rows.map((r) => ({
      invitationId: r.invitation_id,
      associationName: r.association_name,
      associationSlug: r.association_slug,
      teamId: r.team_id,
      teamName: r.team_name,
      kind: r.kind,
      memberName: r.member_name,
      inviterName: r.inviter_name,
      expiresAt: new Date(r.expires_at),
    }));
  });
}
