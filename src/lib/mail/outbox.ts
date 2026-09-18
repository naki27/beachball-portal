import type { Db } from "@/db/client";
import { mailLogs } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { MailType } from "./types";

// メールの送信待ち（設計書 §11「送り方」）。唯一の積み方
// 業務の処理と同じトランザクション（tx）の中で mail_logs に status = queued を INSERT する
// （申込が保存されたのにメールが積まれない、を起こさない）。送るのは pnpm job:mail（src/lib/mail/queue.ts）
// params には本文を組み立てるための ID だけを入れる（本文・生年月日は入れない・付録 A）

export type EnqueueMailInput = {
  // 協会に属さないメールは null（件名はサイト名になる）
  associationId: string | null;
  mailType: Exclude<MailType, "login_code" | "email_change_code">;
  toEmail: string;
  userId?: string | null;
  entryId?: string | null;
  params?: Record<string, unknown>;
};

export async function enqueueMail(tx: Tx | Db, input: EnqueueMailInput): Promise<string> {
  // app_user は mail_logs に insert しか持たない（読むのは管理画面用の関数経由・§5.14）。
  // RETURNING には select が要るので、id はここで作る
  const id = crypto.randomUUID();
  await tx.insert(mailLogs).values({
    id,
    associationId: input.associationId,
    mailType: input.mailType,
    toEmail: input.toEmail,
    userId: input.userId ?? null,
    entryId: input.entryId ?? null,
    params: input.params ?? {},
  });
  return id;
}
