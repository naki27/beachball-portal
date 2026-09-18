import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// セッション（設計書 §9.2）。Cookie には乱数 ID、DB にはそのハッシュ
// - 10 日で失効。アクセスがあれば延長するが、DB を書くのは前回の更新から 1 日以上たったときだけ
//   （テナント管理者だけは last_seen_at を 1 分に 1 回まで更新する。同時ログインの制限の「30 分の逃げ道」に使う）
// - 発行から 90 日（absolute_expires_at）を超えたら延長しない
// - Cookie の Max-Age は 90 日にし、有効期限は DB を正とする（Server Component からは Cookie を書き換えられないため・docs/adr/0005）

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const SESSION_ABSOLUTE_DAYS = 90;
export const SESSION_TOUCH_INTERVAL_MS = DAY_MS;
export const ADMIN_TOUCH_INTERVAL_MS = MINUTE_MS;
// テナント管理者の既存のセッションが、この時間だけ操作されていなければ終了して新しいログインを受け付ける【仮】
export const ADMIN_IDLE_TAKEOVER_MS = 30 * MINUTE_MS;

export function sessionTtlDays(): number {
  const n = Number(process.env.SESSION_TTL_DAYS ?? 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function sessionSliding(): boolean {
  return (process.env.SESSION_SLIDING ?? "true") !== "false";
}

export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

export type SessionRow = typeof sessions.$inferSelect;

export type CreatedSession = { id: string; row: SessionRow };

export async function createSession(tx: Tx | Db, userId: string, now: Date = new Date()): Promise<CreatedSession> {
  const id = generateSessionId();
  const absolute = new Date(now.getTime() + SESSION_ABSOLUTE_DAYS * DAY_MS);
  const expires = new Date(Math.min(now.getTime() + sessionTtlDays() * DAY_MS, absolute.getTime()));
  const [row] = await tx
    .insert(sessions)
    .values({ userId, sessionHash: hashSessionId(id), expiresAt: expires, absoluteExpiresAt: absolute, lastSeenAt: now })
    .returning();
  return { id, row };
}

// どこかの協会のテナント管理者か（SECURITY DEFINER 関数。app.user_id をこのトランザクションに限って設定する）
export async function isAssociationAdminAnywhere(db: Db | Tx, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const result = await tx.execute<{ admin: boolean }>(sql`select current_user_is_association_admin() as admin`);
    return result.rows[0]?.admin === true;
  });
}

// Cookie の ID からセッションを読む。期限切れ・なしは null
// スライディング更新は 1 日 1 回だけ DB を書く。テナント管理者は last_seen_at を 1 分に 1 回まで更新する
export async function loadSession(db: Db | Tx, sessionId: string, now: Date = new Date()): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.sessionHash, hashSessionId(sessionId)), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)),
    )
    .limit(1);
  if (!row) return null;
  if (!sessionSliding()) return row;

  const sinceSeen = now.getTime() - row.lastSeenAt.getTime();
  if (sinceSeen < ADMIN_TOUCH_INTERVAL_MS) return row;
  if (sinceSeen < SESSION_TOUCH_INTERVAL_MS && !(await isAssociationAdminAnywhere(db, row.userId))) return row;

  const expiresAt = new Date(Math.min(now.getTime() + sessionTtlDays() * DAY_MS, row.absoluteExpiresAt.getTime()));
  const [updated] = await db
    .update(sessions)
    .set({ expiresAt, lastSeenAt: now })
    .where(eq(sessions.id, row.id))
    .returning();
  return updated ?? row;
}

export async function deleteSession(db: Db | Tx, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.sessionHash, hashSessionId(sessionId)));
}

// そのユーザーのセッションをまとめて終了する（§9.2「セッションを自動で失効させる場面」）
// exceptSessionId を渡すと、そのセッション（操作した本人のもの）だけ残す。消した数を返す
export async function endUserSessions(
  db: Db | Tx,
  userId: string,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  const condition = options.exceptSessionId
    ? and(eq(sessions.userId, userId), ne(sessions.sessionHash, hashSessionId(options.exceptSessionId)))
    : eq(sessions.userId, userId);
  const rows = await db.delete(sessions).where(condition).returning({ id: sessions.id });
  return rows.length;
}

// そのユーザーの有効なセッション（期限内）
export async function activeSessionsOf(db: Db | Tx, userId: string, now: Date = new Date()): Promise<SessionRow[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now), gt(sessions.absoluteExpiresAt, now)));
}
