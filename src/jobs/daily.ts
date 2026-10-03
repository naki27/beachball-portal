// pnpm job:daily — 日次の後始末（設計書 §6.5 の定期ジョブ「日次ジョブ」の 1a の分）。本番は Cloud Scheduler が毎日 3:00（日本時間）に実行する
// 接続は app_job（JOB_DATABASE_URL）。ログには件数だけを出す（氏名・メールアドレスは出さない）
import { closeDb, createDb } from "../db/client";
import { loadEnv, requireEnv } from "../db/env";
import { assertProductionEnv } from "../lib/env/production";
import { formatDailyJobResult, runDailyJob } from "../lib/jobs/daily";
import { sanitizeError } from "../lib/mail/queue";

async function main(): Promise<void> {
  loadEnv();
  assertProductionEnv("job-daily");
  const db = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
  try {
    console.log(`日次ジョブ: ${formatDailyJobResult(await runDailyJob(db))}`);
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  // drizzle のエラー文にはクエリの引数（メールアドレスなど）が入るので、そのままは出さない
  console.error(sanitizeError(error));
  process.exit(1);
});
