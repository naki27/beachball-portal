import { test as base } from "@playwright/test";
import { like, or } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv } from "../../src/db/env";
import { rateLimits } from "../../src/db/schema";

// E2E 共通の fixture。各 spec は @playwright/test の代わりにここから test を import する
// ログインのレート制限（IP 単位 20 回/時など・§9.2）は、E2E が同じ IP から何度もログインすると 1 回の実行の中で上限に達する。
// テストごとにログイン系の数えた行を消す（テスト用の DB だけ。global-setup の掃除と同じ）
async function resetLoginRateLimits(): Promise<void> {
  loadEnv();
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) return;
  const db = createDb(url, { max: 1 });
  try {
    await db.delete(rateLimits).where(or(like(rateLimits.key, "login_request:%"), like(rateLimits.key, "login_verify:%")));
  } finally {
    await closeDb(db);
  }
}

export const test = base.extend<{ freshLoginLimits: void }>({
  freshLoginLimits: [
    async ({}, use) => {
      await resetLoginRateLimits();
      await use();
    },
    { auto: true },
  ],
});
