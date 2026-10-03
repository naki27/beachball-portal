// pnpm storage:check — 本物の R2 につながることを確かめる（X-01・設計書 §6.3・§5.9）
// 人が手元の PC で実行する。本番の値は `.env.production.local`（Git に入れない）に書く。なければ `.env` を使う
// 画面に出すのは手順と結果だけ（キー・アカウント ID・バケット名は出さない）
import { loadEnv } from "../db/env";
import { formatCheckResult, runStorageCheck } from "../lib/storage/check";
import { createStorage } from "../lib/storage";
import type { StorageBucket } from "../lib/storage/types";

const PRODUCTION_ENV_FILE = ".env.production.local";

function hasBackupKeys(): boolean {
  return Boolean(process.env.R2_BACKUP_ACCESS_KEY_ID && process.env.R2_BACKUP_SECRET_ACCESS_KEY);
}

async function main(): Promise<void> {
  const fromProduction = loadEnv(PRODUCTION_ENV_FILE);
  if (!fromProduction) {
    loadEnv();
    console.log(`${PRODUCTION_ENV_FILE} がないので .env を使います（ローカルの確かめ）`);
  }

  const storage = createStorage();
  console.log(`保存先: ${storage.driver}`);

  const buckets: StorageBucket[] = ["private", "public"];
  if (hasBackupKeys() || storage.driver === "local") buckets.push("backup");
  else console.log("バックアップ用のキー（R2_BACKUP_ACCESS_KEY_ID）がないので backup は飛ばします");

  // 配信の URL（PUBLIC_FILES_BASE_URL）は X-05 で整うまで届かないので、https のときだけ取ってみる
  const publicBaseUrl = process.env.PUBLIC_FILES_BASE_URL ?? "";
  const fetchPublicUrl = publicBaseUrl.startsWith("https://");
  if (!fetchPublicUrl) console.log("PUBLIC_FILES_BASE_URL が https でないので、配信の URL は確かめません");

  const result = await runStorageCheck(storage, { buckets, fetchPublicUrl });
  console.log(formatCheckResult(result));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
