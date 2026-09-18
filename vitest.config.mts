import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "./src/db/env";

// `tests/db/` は Postgres（.env の DATABASE_URL）が要る
loadEnv();

// ユニットテスト（Vitest）。`pnpm test` は TZ=UTC と TZ=Asia/Tokyo の 2 回流す（設計書 §12.1）
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    // DB のテストは 1 接続で流し、SET LOCAL が次の問い合わせに漏れていないことを確かめる
    env: { DB_POOL_MAX: "1" },
  },
});
