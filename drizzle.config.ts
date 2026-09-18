import { defineConfig } from "drizzle-kit";
import { loadEnv, requireEnv } from "./src/db/env";

loadEnv();

// drizzle-kit（generate / migrate / studio）の設定。接続はマイグレーション用のロール app_owner（設計書 §6.3）
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  // TS の camelCase を列名の snake_case に対応させる（src/db/client.ts の drizzle() と同じ設定にする）
  casing: "snake_case",
  dbCredentials: { url: requireEnv("MIGRATION_DATABASE_URL") },
  strict: true,
  verbose: true,
});
