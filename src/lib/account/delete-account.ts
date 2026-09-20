import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { requireEnv } from "@/db/env";
import { loginCodes, users } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { matchLoginCode } from "@/lib/auth/match-code";

// アカウントの削除（設計書 §5.19）。協会をまたぐので SECURITY DEFINER 関数（0009）で行う
// 削除できない場合は理由を返し、画面が次の手順を出す（代表者・協会の管理者・運営管理者）

export type DeletionBlock = "team_admin" | "association_admin" | "platform_admin";

export const DELETION_BLOCK_MESSAGE: Record<DeletionBlock, string> = {
  team_admin:
    "代表者を務めているチームがあります。ほかの代表者に任せて降りるか、チームを解散する場合は問い合わせフォームで協会に連絡してください",
  association_admin: "協会の管理者のため削除できません。運営者にお問い合わせください",
  platform_admin: "運営管理者のため削除できません",
};

export type DeleteAccountInput = {
  userId: string;
  // 確認番号（いまのメールアドレスに送ったもの）
  attemptId: string | null;
  code: string;
  ip: string;
  now?: Date;
};

export type DeleteAccountResult =
  | { ok: true; unlinkedMembers: number; cancelledInvitations: number }
  | { ok: false; reason: "invalid"; remaining: number }
  | { ok: false; reason: "blocked"; blockedBy: DeletionBlock };

// 削除できない理由（画面に先に出す）。ないときは null
export async function accountDeletionBlock(db: Db | Tx, userId: string): Promise<DeletionBlock | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const result = await tx.execute<{ block: DeletionBlock | null }>(
      sql`select my_account_deletion_block() as block`,
    );
    return result.rows[0]?.block ?? null;
  });
}

// 元に戻せないメールアドレス（削除済みの行に残す。同じアドレスで作り直せるようにするため）
function erasedEmail(): string {
  return `deleted-${crypto.randomUUID()}@deleted.invalid`;
}

export async function deleteMyAccount(db: Db, input: DeleteAccountInput): Promise<DeleteAccountResult> {
  const now = input.now ?? new Date();
  const hmacKey = requireEnv("LOGIN_CODE_HMAC_KEY");

  return db.transaction(async (tx) => {
    const match = await matchLoginCode(tx, {
      attemptId: input.attemptId,
      code: input.code,
      purpose: "login",
      ip: input.ip,
      hmacKey,
      now,
    });
    if (!match.ok) return { ok: false, reason: "invalid", remaining: match.remaining };

    // その番号が、いまのアカウントのメールアドレス宛てに出したものであること
    const [me] = await tx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!me || me.email.toLowerCase() !== match.row.email.toLowerCase()) {
      return { ok: false, reason: "invalid", remaining: 0 };
    }
    await tx
      .update(loginCodes)
      .set({ usedAt: now })
      .where(and(eq(loginCodes.email, me.email), isNull(loginCodes.usedAt)));

    await tx.execute(sql`select set_config('app.user_id', ${input.userId}, true)`);
    const result = await tx.execute<{
      blocked_by: DeletionBlock | null;
      unlinked_members: number;
      cancelled_invitations: number;
    }>(sql`select * from delete_my_account(${erasedEmail()})`);
    const row = result.rows[0];
    if (!row) return { ok: false, reason: "invalid", remaining: 0 };
    if (row.blocked_by) return { ok: false, reason: "blocked", blockedBy: row.blocked_by };
    return {
      ok: true,
      unlinkedMembers: Number(row.unlinked_members),
      cancelledInvitations: Number(row.cancelled_invitations),
    };
  });
}
