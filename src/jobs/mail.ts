// pnpm job:mail — 送信待ちのメールを送る（設計書 §6.5 の定期ジョブ「メール送信」）。本番は Cloud Scheduler が数分おきに実行する
// 接続は app_job（JOB_DATABASE_URL）。ログには件数だけを出す（宛先は出さない）
import { closeDb, createDb } from "../db/client";
import { loadEnv, requireEnv } from "../db/env";
import { processMailQueue, sanitizeError } from "../lib/mail/queue";
import { createMailSender } from "../lib/mail/sender";

async function main(): Promise<void> {
  loadEnv();
  const db = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
  const sender = createMailSender();
  try {
    const result = await processMailQueue(db, sender, { baseUrl: process.env.APP_BASE_URL });
    console.log(`メール送信: 送った ${result.sent} 件、再試行 ${result.retried} 件、失敗 ${result.failed} 件`);
    if (result.failed > 0) process.exitCode = 1; // 監視（§6.7）が拾えるように
  } finally {
    await sender.close?.();
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  // drizzle のエラー文にはクエリの引数（宛先）が入るので、そのままは出さない
  console.error(sanitizeError(error));
  process.exit(1);
});
