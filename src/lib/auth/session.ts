import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// セッション（設計書 §9.2）。Cookie には乱数 ID、DB にはそのハッシュ
// - 10 日で失効。アクセスがあれば延長するが、DB を書くのは前回の更新から 1 日以上たったときだけ
// - 発行から 90 日（absolute_expires_at）を超えたら延長しない
// - Cookie の Max-Age は 90 日にし、有効期限は DB を正とする（Server Component からは Cookie を書き換えられないため・docs/adr/0005）

export const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_DAYS = 90;
export const SESSION_TOUCH_INTERVAL_MS = DAY_MS;

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

// Cookie の ID からセッションを読む。期限切れ・なしは null。スライディング更新は 1 日 1 回だけ DB を書く
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
  if (now.getTime() - row.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) return row;

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
