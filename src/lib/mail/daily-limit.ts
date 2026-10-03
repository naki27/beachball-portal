import { and, between, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mailLogs } from "@/db/schema";
import { endOfDayTokyo, formatPlainDate, startOfDayTokyo, todayInTokyo } from "@/lib/date";

// 1 日の送信数の見張り（設計書 §11.2・X-01）。無料プランの上限を超えるとその日は誰もログインできなくなる
// 送信ジョブが走るたびに「当日（日本時間）に送れた数」を数え、上限の 8 割を**跨いだ回だけ**決まった形のログを 1 行出す
// 跨いだ回だけなので、同じ日に何度ジョブが走っても 1 回しか出ない。知らせる仕組み（通知）は X-04

export const DEFAULT_MAIL_DAILY_LIMIT = 300;
export const WARN_RATIO = 0.8;
export const ALERT_NAME = "mail_daily_limit";

export function mailDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.MAIL_DAILY_LIMIT);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAIL_DAILY_LIMIT;
}

// 警告を出す件数（上限の 8 割。端数は切り上げ）
export function warnThreshold(limit: number): number {
  return Math.ceil(limit * WARN_RATIO);
}

// 数える範囲（日本時間のその日の 0:00〜23:59:59.999）。サーバーの TZ には頼らない（§7.0）
export function sentTodayWindow(now: Date): { from: Date; to: Date } {
  const today = todayInTokyo(now);
  return { from: startOfDayTokyo(today), to: endOfDayTokyo(today) };
}

// 当日（日本時間）に送れたメールの数。確認番号のように送信待ちを通さないものも sent で記録されるので入る
export async function countSentToday(db: Db, now: Date): Promise<number> {
  const { from, to } = sentTodayWindow(now);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mailLogs)
    .where(and(eq(mailLogs.status, "sent"), between(mailLogs.sentAt, from, to)));
  return row?.count ?? 0;
}

export type DailyLimitInput = {
  // ジョブが送る前・送ったあとの当日の件数
  before: number;
  after: number;
  limit: number;
  now: Date;
};

// 8 割を跨いだときだけ、決まった形の 1 行（監視が拾う）。個人情報は入れない
export function dailyLimitAlert({ before, after, limit, now }: DailyLimitInput): string | null {
  const threshold = warnThreshold(limit);
  if (before >= threshold || after < threshold) return null;
  return JSON.stringify({
    alert: ALERT_NAME,
    date: formatPlainDate(todayInTokyo(now)),
    sent: after,
    limit,
    threshold,
  });
}
