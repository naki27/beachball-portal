import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  adminAccessLogs,
  associationAdminInvitations,
  loginCodes,
  mailLogs,
  rateLimits,
  sessions,
  teamInvitations,
  users,
} from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import { enqueueMail } from "@/lib/mail/outbox";
import { listAllAssociations } from "@/lib/repo/associations";
import { getStorage } from "@/lib/storage";
import type { StorageAdapter } from "@/lib/storage/types";
import { cleanupDocuments } from "./document-cleanup";
import { backupClosedTournamentEntries } from "./entry-backup";

// 日次ジョブ（設計書 §6.5.1 の定期ジョブの表 ②③④⑤）。app_job（JOB_DATABASE_URL）で動かす
// ⑥ の大会資料の後始末は document-cleanup.ts。① DB バックアップ（pg_dump）・⑦ 最小インスタンス数は後のタスク（X-03・X-04）
// 協会に属する表はかならず withTenantOn で協会ごとに処理する（§5.14）。ログには件数だけを出す（氏名・メールアドレスは出さない）

const DAY_MS = 24 * 60 * 60 * 1000;

// 記録の保存期間（§12「記録の保存期間」の表。1a にある表の分だけ。entry_audits・export_logs・billing_documents は B-01 以降）
export const RETENTION_DAYS = {
  // 招待: 返事・期限切れ・取り消しから 1 年
  invitations: 365,
  // メールの送信記録: 1 年
  mailLogs: 365,
  // 管理者の操作記録: 3 年
  adminAccessLogs: 365 * 3,
  // レート制限の回数: 1 日
  rateLimits: 1,
} as const;

export type DailyJobResult = {
  // 締切後の申込一覧 CSV のバックアップ（②・§5.5(f)）
  backedUpTournaments: number;
  // 作れなかった大会（消された直後など）。次の日にまた試す
  skippedBackups: number;
  // 期限切れの物理削除（③）
  loginCodes: number;
  sessions: number;
  rateLimits: number;
  // 期限切れの招待を expired にした件数（④）
  expiredTeamInvitations: number;
  expiredAdminInvitations: number;
  // 保存期間を過ぎた記録の物理削除（⑤）
  purgedTeamInvitations: number;
  purgedAdminInvitations: number;
  purgedMailLogs: number;
  purgedAdminAccessLogs: number;
  // 大会資料の後始末（⑥・§5.9）: 公開の整合と、消し忘れたファイル
  documentsPublished: number;
  documentsWithdrawn: number;
  documentsMissing: number;
  documentFilesRemoved: number;
};

export type DailyJobOptions = {
  now?: Date;
  // 保存先を差し替えられるようにする（テスト・ローカル）。既定は STORAGE_DRIVER に従う
  storage?: StorageAdapter;
};

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

// drizzle の delete は件数を返さないので、rowCount を数える
function deletedCount(result: unknown): number {
  const rowCount = (result as { rowCount?: number | null }).rowCount;
  return rowCount ?? 0;
}

// ③ 期限切れの確認番号・セッション・レート制限（テナントに属さない表。RLS なし）
async function purgeExpiredAuth(db: Db, now: Date): Promise<Pick<DailyJobResult, "loginCodes" | "sessions" | "rateLimits">> {
  const codes = await db.delete(loginCodes).where(lte(loginCodes.expiresAt, now));
  // セッションは期限（スライディング）か絶対期限のどちらかが過ぎたら無効（src/lib/auth/session.ts と同じ判定）
  const dead = await db
    .delete(sessions)
    .where(or(lte(sessions.expiresAt, now), lte(sessions.absoluteExpiresAt, now)));
  const limits = await db.delete(rateLimits).where(lt(rateLimits.windowStart, daysAgo(now, RETENTION_DAYS.rateLimits)));
  return { loginCodes: deletedCount(codes), sessions: deletedCount(dead), rateLimits: deletedCount(limits) };
}

// ④ 期限切れの招待を expired にして、招待した人に知らせる（§5.14・§5.15）
// 知らせは送信待ちの表に積むだけ（送るのは pnpm job:mail）。削除済みのアカウントには積まない
async function expireInvitations(db: Db, associationId: string, now: Date): Promise<{ team: number; admin: number }> {
  return withTenantOn(db, associationId, async (tx) => {
    const teamRows = await tx
      .select({ id: teamInvitations.id, invitedBy: teamInvitations.invitedBy })
      .from(teamInvitations)
      .where(and(eq(teamInvitations.status, "pending"), lte(teamInvitations.expiresAt, now)));
    for (const row of teamRows) {
      await tx.update(teamInvitations).set({ status: "expired" }).where(eq(teamInvitations.id, row.id));
      await notifyInviter(tx, associationId, row.invitedBy, "team_invitation_expired", row.id);
    }

    const adminRows = await tx
      .select({ id: associationAdminInvitations.id, invitedBy: associationAdminInvitations.invitedBy })
      .from(associationAdminInvitations)
      .where(and(eq(associationAdminInvitations.status, "pending"), lte(associationAdminInvitations.expiresAt, now)));
    for (const row of adminRows) {
      await tx.update(associationAdminInvitations).set({ status: "expired" }).where(eq(associationAdminInvitations.id, row.id));
      await notifyInviter(tx, associationId, row.invitedBy, "association_admin_invitation_expired", row.id);
    }

    return { team: teamRows.length, admin: adminRows.length };
  });
}

async function notifyInviter(
  tx: Tx,
  associationId: string,
  invitedBy: string,
  mailType: "team_invitation_expired" | "association_admin_invitation_expired",
  invitationId: string,
): Promise<void> {
  const [inviter] = await tx
    .select({ email: users.email, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, invitedBy))
    .limit(1);
  if (!inviter || inviter.deletedAt) return; // 削除済みのアカウントのアドレスは使えない（§5.19）
  await enqueueMail(tx, {
    associationId,
    mailType,
    toEmail: inviter.email,
    userId: invitedBy,
    params: { invitationId },
  });
}

// ⑤ 保存期間を過ぎた招待の物理削除。返事・期限切れ・取り消しから 1 年（返事がないまま期限が切れた分は期限から数える）
async function purgeInvitations(db: Db, associationId: string, cutoff: Date): Promise<{ team: number; admin: number }> {
  return withTenantOn(db, associationId, async (tx) => {
    const team = await tx
      .delete(teamInvitations)
      .where(
        and(
          sql`${teamInvitations.status} <> 'pending'`,
          lt(sql`coalesce(${teamInvitations.respondedAt}, ${teamInvitations.expiresAt})`, cutoff),
        ),
      );
    const admin = await tx
      .delete(associationAdminInvitations)
      .where(
        and(
          sql`${associationAdminInvitations.status} <> 'pending'`,
          lt(sql`coalesce(${associationAdminInvitations.respondedAt}, ${associationAdminInvitations.expiresAt})`, cutoff),
        ),
      );
    return { team: deletedCount(team), admin: deletedCount(admin) };
  });
}

export async function runDailyJob(db: Db, options: DailyJobOptions = {}): Promise<DailyJobResult> {
  const now = options.now ?? new Date();
  const result: DailyJobResult = {
    ...(await purgeExpiredAuth(db, now)),
    backedUpTournaments: 0,
    skippedBackups: 0,
    expiredTeamInvitations: 0,
    expiredAdminInvitations: 0,
    purgedTeamInvitations: 0,
    purgedAdminInvitations: 0,
    purgedMailLogs: 0,
    purgedAdminAccessLogs: 0,
    documentsPublished: 0,
    documentsWithdrawn: 0,
    documentsMissing: 0,
    documentFilesRemoved: 0,
  };

  const invitationCutoff = daysAgo(now, RETENTION_DAYS.invitations);
  for (const association of await listAllAssociations(db)) {
    const expired = await expireInvitations(db, association.id, now);
    result.expiredTeamInvitations += expired.team;
    result.expiredAdminInvitations += expired.admin;
    const purged = await purgeInvitations(db, association.id, invitationCutoff);
    result.purgedTeamInvitations += purged.team;
    result.purgedAdminInvitations += purged.admin;
  }

  // 送信記録・操作記録はテナントに属さない表（協会ごとではなくまとめて消す）
  const mails = await db.delete(mailLogs).where(lt(mailLogs.createdAt, daysAgo(now, RETENTION_DAYS.mailLogs)));
  result.purgedMailLogs = deletedCount(mails);
  const logs = await db
    .delete(adminAccessLogs)
    .where(lt(adminAccessLogs.createdAt, daysAgo(now, RETENTION_DAYS.adminAccessLogs)));
  result.purgedAdminAccessLogs = deletedCount(logs);

  // ② 締切後の申込一覧 CSV のバックアップ（暗号化してバックアップ用の保存先へ・§5.5(f)）
  const storage = options.storage ?? getStorage();
  const backup = await backupClosedTournamentEntries(db, storage, now);
  result.backedUpTournaments = backup.tournaments;
  result.skippedBackups = backup.skipped;

  // ⑥ 大会資料の公開の整合と、消し忘れたファイルの後始末（§5.9）
  const documents = await cleanupDocuments(db, storage);
  result.documentsPublished = documents.published;
  result.documentsWithdrawn = documents.withdrawn;
  result.documentsMissing = documents.missing;
  result.documentFilesRemoved = documents.removedPrivate + documents.removedPublic;

  return result;
}

// ログに出す 1 行（件数だけ）
export function formatDailyJobResult(result: DailyJobResult): string {
  return [
    `確認番号 ${result.loginCodes} 件`,
    `セッション ${result.sessions} 件`,
    `レート制限 ${result.rateLimits} 件`,
    `期限切れの招待 チーム ${result.expiredTeamInvitations} 件 / 協会の管理者 ${result.expiredAdminInvitations} 件`,
    `保存期間切れ 招待 ${result.purgedTeamInvitations + result.purgedAdminInvitations} 件 / 送信記録 ${result.purgedMailLogs} 件 / 操作記録 ${result.purgedAdminAccessLogs} 件`,
    `申込一覧のバックアップ ${result.backedUpTournaments} 大会${result.skippedBackups > 0 ? `（${result.skippedBackups} 大会は作れず）` : ""}`,
    `大会資料 公開 ${result.documentsPublished} 件 / 取り下げ ${result.documentsWithdrawn} 件 / 消し忘れ ${result.documentFilesRemoved} 件${result.documentsMissing > 0 ? `（${result.documentsMissing} 件は保管用がなく公開できず）` : ""}`,
  ].join("、");
}
