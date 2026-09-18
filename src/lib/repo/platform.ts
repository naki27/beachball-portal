import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { Tx } from "@/db/tenant";

// 運営管理者の横断画面（設計書 §5.14「運営管理者」）。RLS を素通しにせず、SECURITY DEFINER 関数から件数と管理者だけを読む
// 関数は app.user_id が運営管理者のときだけ行を返す（そうでなければ 0 行）

export type AssociationStats = {
  associationId: string;
  teams: number;
  members: number;
  openTournaments: number;
  admins: number;
  pendingAdminInvitations: number;
};

export type AssociationAdminRow = {
  associationId: string;
  userId: string;
  email: string;
  displayName: string | null;
  grantedAt: Date;
};

async function withUser<T>(db: Db | Tx, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export async function listAssociationStats(db: Db | Tx, userId: string): Promise<AssociationStats[]> {
  return withUser(db, userId, async (tx) => {
    const result = await tx.execute<{
      association_id: string;
      teams: string;
      members: string;
      open_tournaments: string;
      admins: string;
      pending_admin_invitations: string;
    }>(sql`select * from platform_association_stats()`);
    return result.rows.map((r) => ({
      associationId: r.association_id,
      teams: Number(r.teams),
      members: Number(r.members),
      openTournaments: Number(r.open_tournaments),
      admins: Number(r.admins),
      pendingAdminInvitations: Number(r.pending_admin_invitations),
    }));
  });
}

// テナント管理者のメールアドレスと表示名は運営管理者に見せてよい（§5.14 v0.9）
export async function listAssociationAdmins(db: Db | Tx, userId: string): Promise<AssociationAdminRow[]> {
  return withUser(db, userId, async (tx) => {
    const result = await tx.execute<{
      association_id: string;
      user_id: string;
      email: string;
      display_name: string | null;
      granted_at: string | Date;
    }>(sql`select * from platform_association_admins()`);
    return result.rows.map((r) => ({
      associationId: r.association_id,
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      grantedAt: new Date(r.granted_at),
    }));
  });
}
