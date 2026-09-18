import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { eq } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationSlugHistory } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";

// 協会の URL と 404 / 403（設計書 §3.1・§5.14）。seed 済みの DB（早良区協会 = sawara）が要る
// 旧スラッグの行は worker ごとに別の名前で入れ、最後に消す

test("協会のトップが開き、検索エンジンには載せない", async ({ page }) => {
  const response = await page.goto("/sawara");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("早良区協会");
  expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("ないスラッグは 404 のページ（協会は決まらないのでサイトのトップへ戻る）", async ({ page }) => {
  const response = await page.goto("/nothing");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ページが見つかりません");
  await expect(page.getByRole("link", { name: "トップへ戻る" })).toHaveAttribute("href", "/");
});

test("予約語は協会の画面にならない", async ({ page }) => {
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});

test("/sawara/admin は 403。ログインボタンと、協会のトップへ戻るボタン", async ({ page }) => {
  const response = await page.goto("/sawara/admin");
  expect(response?.status()).toBe(403);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("このページを見るにはログインが必要です");
  await expect(page.getByRole("link", { name: "ログインする" })).toHaveAttribute("href", "/login?next=%2Fsawara%2Fadmin");
  await expect(page.getByRole("link", { name: "早良区協会のトップへ戻る" })).toHaveAttribute("href", "/sawara");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("robots.txt は全部 Disallow", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/^Disallow: \/$/m);
});

test.describe("旧スラッグ", () => {
  let oldSlug = "";
  const owner = () => createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });

  test.beforeAll(async ({}, testInfo) => {
    loadEnv();
    oldSlug = `sawara-old-e2e-${testInfo.workerIndex}`;
    const db = owner();
    await withTenantOn(db, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(associationSlugHistory).where(eq(associationSlugHistory.slug, oldSlug));
      await tx.insert(associationSlugHistory).values({ slug: oldSlug, associationId: SAWARA_ASSOCIATION_ID });
    });
    await closeDb(db);
  });

  test.afterAll(async () => {
    const db = owner();
    await withTenantOn(db, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(associationSlugHistory).where(eq(associationSlugHistory.slug, oldSlug));
    });
    await closeDb(db);
  });

  test("308 で新しいスラッグへ。パスと検索文字列を保つ", async ({ request }) => {
    const response = await request.get(`/${oldSlug}/admin?tab=x&y=1`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toBe("/sawara/admin?tab=x&y=1");
  });

  test("ブラウザで開くと新しい URL に着く", async ({ page }) => {
    await page.goto(`/${oldSlug}`);
    await expect(page).toHaveURL(/\/sawara$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("早良区協会");
  });
});
