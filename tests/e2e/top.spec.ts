import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, associations, sessions, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { SITE_NAME } from "../../src/lib/site";

// 入口（/）・マイページ・協会の切り替え（設計書 §5.3・§5.14）
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

async function latestCode(request: Req, email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email} subject:確認番号`)}`);
    const body = (await res.json()) as { messages: { Subject: string }[] };
    const m = body.messages?.[0]?.Subject.match(/(\d{6})$/);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("確認番号のメールが届かない");
}

const headerMenu = (page: Page) => page.locator("header summary", { hasText: "メニュー" });

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("入口（/）は未ログインなら 403 で、スマホ幅で横にはみ出さない", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(SITE_NAME);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("このページを見るにはログインが必要です");
  await expect(page.getByRole("link", { name: "ログインする" })).toHaveAttribute("href", "/login?next=%2F");
  await noHorizontalOverflow(page);
});

test("2 つの協会に関わる人: 入口に両方が出て、メニューから協会を切り替えられる。マイページは協会ごとの枠", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const email = `e2e-top-${stamp}@example.com`;
  const otherName = `E2E切り替え協会${stamp}`;
  const [other] = await owner
    .insert(associations)
    .values({ name: otherName, slug: `e2e-top-${stamp}` })
    .returning({ id: associations.id, slug: associations.slug });
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: user.id }),
  );
  await withTenantOn(owner, other.id, (tx) => tx.insert(associationAdmins).values({ associationId: other.id, userId: user.id }));

  try {
    // 入口から「ログインする」→ 番号 → 入口に戻る（リダイレクトせず、協会の一覧）
    await page.goto("/");
    await page.getByRole("link", { name: "ログインする" }).click();
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByRole("button", { name: "確認番号を送る" }).click();
    await expect(page).toHaveURL(/\/login\/code/, { timeout: 15_000 });
    await page.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email));
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    const list = page.getByRole("region", { name: "あなたが関わっている協会" });
    await expect(list.getByRole("link", { name: /早良区協会/ })).toBeVisible({ timeout: 15_000 });
    await expect(list.getByRole("link", { name: new RegExp(otherName) })).toContainText("協会の管理者");

    // 早良区協会 → メニューの「協会を切り替える」でもう 1 つの協会へ
    await list.getByRole("link", { name: /早良区協会/ }).click();
    await expect(page).toHaveURL(/\/sawara$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "受付中の大会" })).toBeVisible();
    await headerMenu(page).click();
    const switcher = page.getByRole("navigation", { name: "協会を切り替える" });
    await expect(switcher.getByRole("link", { name: /早良区協会/ })).toHaveAttribute("aria-current", "page");
    await switcher.getByRole("link", { name: new RegExp(otherName) }).click();
    await expect(page).toHaveURL(new RegExp(`/${other.slug}$`), { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(otherName);

    // メニュー → マイページ。協会ごとの枠と、表示名の変更
    await headerMenu(page).click();
    await page.getByRole("link", { name: "マイページ" }).click();
    await expect(page).toHaveURL(/\/mypage$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 2, name: "早良区協会" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: otherName })).toBeVisible();
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("表示名（任意）").fill("  E2E　太郎 ");
    await page.getByRole("button", { name: "表示名を変更する" }).click();
    await expect(page.getByText("表示名を変更しました")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("表示名（任意）")).toHaveValue("E2E 太郎");
    await noHorizontalOverflow(page);
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) => tx.delete(associationAdmins).where(eq(associationAdmins.userId, user.id)));
    await withTenantOn(owner, other.id, (tx) => tx.delete(associationAdmins).where(eq(associationAdmins.associationId, other.id)));
    await owner.delete(associations).where(eq(associations.id, other.id));
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
  }
});
