import { and, eq, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mailLogs } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { findAssociationById } from "@/lib/repo/associations";
import { composeMail, hasTemplate } from "./templates";
import type { MailSender } from "./types";

// 送信ジョブ（設計書 §6.5 の定期ジョブ「メール送信」・§11「送り方」）。app_job（JOB_DATABASE_URL）で動かす
// queued の行を取り出し、本文を組み立てて送る。成功で sent、失敗は間隔を延ばして再試行し、5 回で failed
// ログとエラー欄に個人情報（宛先など）を入れない

export const MAX_ATTEMPTS = 5;
// n 回目の失敗のあと、次に試すまでの分【仮】
export const RETRY_MINUTES = [1, 5, 15, 60, 180] as const;

export type ProcessOptions = {
  now?: Date;
  batchSize?: number;
  // メール本文の URL の先頭（APP_BASE_URL）
  baseUrl?: string;
};

export type ProcessResult = { sent: number; retried: number; failed: number };

const EMAIL_PATTERN = /[^\s@<>]+@[^\s@<>]+/g;

// エラーの記録用。メールアドレスを消し、長さを抑える
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(EMAIL_PATTERN, "<email>").slice(0, 500);
}

export function nextAttemptAfter(attempts: number, now: Date): Date {
  const minutes = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1] ?? RETRY_MINUTES[RETRY_MINUTES.length - 1];
  return new Date(now.getTime() + minutes * 60_000);
}

type QueuedRow = typeof mailLogs.$inferSelect;

async function deliver(tx: Tx, row: QueuedRow, sender: MailSender, now: Date, baseUrl: string): Promise<"sent" | "retried" | "failed"> {
  // 雛形がない種別は、何度試しても同じなので再試行しない
  if (!hasTemplate(row.mailType)) {
    await tx
      .update(mailLogs)
      .set({ status: "failed", attempts: row.attempts + 1, error: `template missing: ${row.mailType}` })
      .where(eq(mailLogs.id, row.id));
    return "failed";
  }

  try {
    const association = row.associationId ? await findAssociationById(tx, row.associationId) : null;
    const composed = composeMail(row.mailType, row.params, { associationName: association?.name ?? null, baseUrl });
    const result = await sender.send({ to: row.toEmail, ...composed });
    await tx
      .update(mailLogs)
      .set({
        status: "sent",
        attempts: row.attempts + 1,
        sentAt: now,
        providerMessageId: result.providerMessageId ?? null,
        error: null,
      })
      .where(eq(mailLogs.id, row.id));
    return "sent";
  } catch (error) {
    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    await tx
      .update(mailLogs)
      .set({
        status: exhausted ? "failed" : "queued",
        attempts,
        nextAttemptAt: exhausted ? row.nextAttemptAt : nextAttemptAfter(attempts, now),
        error: sanitizeError(error),
      })
      .where(eq(mailLogs.id, row.id));
    return exhausted ? "failed" : "retried";
  }
}

// 1 回分の処理。同時に動くジョブが同じ行を取らないように for update skip locked で取り出す
export async function processMailQueue(db: Db, sender: MailSender, options: ProcessOptions = {}): Promise<ProcessResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 50;
  const baseUrl = options.baseUrl ?? process.env.APP_BASE_URL ?? "";
  const result: ProcessResult = { sent: 0, retried: 0, failed: 0 };

  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(mailLogs)
      .where(and(eq(mailLogs.status, "queued"), lte(mailLogs.nextAttemptAt, now)))
      .orderBy(mailLogs.nextAttemptAt)
      .limit(batchSize)
      .for("update", { skipLocked: true });

    for (const row of rows) {
      const outcome = await deliver(tx, row, sender, now, baseUrl);
      result[outcome]++;
    }
  });

  return result;
}
