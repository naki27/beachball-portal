import { defineConfig } from "@playwright/test";

// E2E（Playwright）。選手側の画面はスマホが 9 割なので WebKit 375×667 と Chromium 360×640 で流し、
// PC でも操作する人がいるので Chromium 1280×800 でも流す（設計書 §4.3 v0.9.6・§12.1・ADR 0028）
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "tests/e2e",
  // dev サーバーはログインの流れが 4 つ以上同時に走ると詰まるので、並列は 2 まで
  workers: 2,
  // 使うページを先に一度ずつ開いて dev サーバーにコンパイルさせる（tests/e2e/global-setup.ts）
  globalSetup: "./tests/e2e/global-setup.ts",
  // dev サーバー（コンパイルと polling）は応答が遅れることがあるので、既定より長く待つ（テスト 60 秒・期待 10 秒）
  timeout: 60_000,
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
    // PC でも操作する人がいる（ADR 0028・§4.3 v0.9.6）。1280×800 でも崩れないことを見る
    {
      name: "chromium-1280x800",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
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
