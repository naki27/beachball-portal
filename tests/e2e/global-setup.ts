import type { FullConfig } from "@playwright/test";
import { like, or } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv } from "../../src/db/env";
import { rateLimits } from "../../src/db/schema";

// 1. dev サーバー（webpack + polling）は、初めて開くページをその場でコンパイルする。テストの途中でコンパイルが走ると、
//    クライアント側の画面遷移が途中の応答を受けて error 境界に落ちることがある（開発時だけの揺らぎ）。
//    そこで、テストが使うページを先に一度ずつ取得して温めておく（状態コードは問わない）
const PATHS = [
  "/",
  "/sawara",
  "/sawara/admin",
  "/nothing",
  "/login",
  "/login?next=%2Fsawara",
  "/login/code",
  "/login/help",
  "/dev/ui",
  "/platform",
  "/robots.txt",
];

// 2. ログインのレート制限（IP 単位 20 回/時など）は、E2E を繰り返すと同じ IP で上限に達する。
//    テストの前にログイン系の数えた行を消す（テスト用の DB だけ。本番の DB に向けない）
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

// API も初回はコンパイルに数秒かかるので、空の POST で先にコンパイルさせる（Origin の検査で 403 になるだけ）
const API_PATHS = ["/api/auth/request", "/api/auth/verify", "/api/auth/logout"];

export default async function globalSetup(config: FullConfig): Promise<void> {
  await resetLoginRateLimits();
  const baseURL = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:3000";
  for (const path of PATHS) {
    try {
      await fetch(new URL(path, baseURL), { redirect: "manual" });
    } catch {
      // サーバーがまだ起きていない場合は webServer の起動待ちに任せる
    }
  }
  for (const path of API_PATHS) {
    try {
      await fetch(new URL(path, baseURL), { method: "POST" });
    } catch {
      // 同上
    }
  }
}
