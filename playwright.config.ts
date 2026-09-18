import { defineConfig } from "@playwright/test";

// E2E（Playwright）。選手側の画面はスマホが 9 割なので、WebKit 375×667 と Chromium 360×640 の 2 つで流す（設計書 §4.3・§12.1）
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "tests/e2e",
  // 使うページを先に一度ずつ開いて dev サーバーにコンパイルさせる（tests/e2e/global-setup.ts）
  globalSetup: "./tests/e2e/global-setup.ts",
  // dev サーバー（コンパイルと polling）は応答が遅れることがあるので、既定の 5 秒より長く待つ
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "webkit-375x667",
      use: {
        browserName: "webkit",
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "chromium-360x640",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 640 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
