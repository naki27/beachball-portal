import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// ユニットテスト（Vitest）。`pnpm test` は TZ=UTC と TZ=Asia/Tokyo の 2 回流す（設計書 §12.1）
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
