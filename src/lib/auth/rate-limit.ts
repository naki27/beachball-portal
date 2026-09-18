import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rateLimits } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// レート制限（設計書 §9.2）。回数は DB の rate_limits で数える（Cloud Run は複数インスタンスなので、メモリでは効かない）
// キーと時間枠ごとに 1 行を UPSERT する。古い行は日次ジョブが消す

export type RateLimitRule = {
  // 例: login_request:email:<sha256>
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = { allowed: true } | { allowed: false; retryAt: Date };

function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

// 1 回分を数えて、上限以内なら allowed。超えていれば次の枠の始まり（retryAt）を返す
export async function consumeRateLimit(db: Db | Tx, rule: RateLimitRule, now: Date = new Date()): Promise<RateLimitResult> {
  const start = windowStart(now, rule.windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: rule.key, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  if (row.count <= rule.limit) return { allowed: true };
  return { allowed: false, retryAt: new Date(start.getTime() + rule.windowMs) };
}

// 複数の規則をまとめて数える。どれか 1 つでも超えていれば拒否（すべて数えるので、拒否された分も回数に入る）
export async function consumeRateLimits(db: Db | Tx, rules: RateLimitRule[], now: Date = new Date()): Promise<RateLimitResult> {
  let denied: RateLimitResult | null = null;
  for (const rule of rules) {
    const result = await consumeRateLimit(db, rule, now);
    if (!result.allowed && (denied === null || (denied.allowed === false && result.retryAt > denied.retryAt))) {
      denied = result;
    }
  }
  return denied ?? { allowed: true };
}

export const HOUR_MS = 60 * 60 * 1000;
