import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import {
  adminAccessLogs,
  associationAdminInvitations,
  associations,
  associationSlugHistory,
  categoryPresets,
  mailLogs,
  platformAdmins,
  sessions,
  users,
} from "../../src/db/schema";
import { withTenantOn } from "../../src/db/tenant";

// 運営管理者とテナントの作成（設計書 §5.14）。運営管理者は DB に直接登録する（画面からは付与できない）
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";

async function latestCode(request: Parameters<Parameters<typeof test>[2]>[0]["request"], email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: { Subject: string }[] };
    const m = body.messages?.[0]?.Subject.match(/(\d{6})$/);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("確認番号のメールが届かない");
}

test("運営管理者以外は /platform が 403", async ({ page }) => {
  await page.goto("/platform");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("このページを見るにはログインが必要です");
});

test("運営管理者は協会を作り、名前を変え、切り替えて入って出られる", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const email = `e2e-platform-${testInfo.workerIndex}-${Date.now()}@example.com`;
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await owner.insert(platformAdmins).values({ userId: user.id, note: "e2e" });
  const stamp = `${testInfo.workerIndex}${Date.now().toString(36)}`;
  const slug = `e2e-${stamp}`;
  const newSlug = `e2e-${stamp}-new`;
  let createdId: string | null = null;

  try {
    // ログイン
    await page.goto("/login?next=%2Fplatform");
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByRole("button", { name: "確認番号を送る" }).click();
    await expect(page).toHaveURL(/\/login\/code/);
    await page.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email));
    await expect(page).toHaveURL(/\/platform$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("運営管理", { timeout: 15_000 });
    await expect(page.getByText("早良区協会")).toBeVisible();

    // 協会を作る
    await page.locator("form[data-hydrated]").first().waitFor();
    await page.getByLabel("協会名").fill(`E2E 協会 ${stamp}`);
    await page.getByLabel(/URL の名前/).fill(slug);
    await page.getByLabel(/最初の管理者のメールアドレス/).fill(`first-admin-${stamp}@example.com`);
    await page.getByRole("button", { name: "協会を作る" }).click();
    await expect(page.getByText(`E2E 協会 ${stamp}を作りました`)).toBeVisible({ timeout: 15_000 });
    // 最初の管理者への招待のメールが送信待ちに積まれる（送るのは job:mail）
    const link = page.getByRole("link", { name: `E2E 協会 ${stamp}` });
    await expect(link).toBeVisible({ timeout: 15_000 });
    const [row] = await owner.select({ id: associations.id }).from(associations).where(eq(associations.slug, slug));
    createdId = row.id;

    // 協会のページで名前と URL を変える
    await link.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`E2E 協会 ${stamp}`, { timeout: 15_000 });
    await page.locator("form[data-hydrated]").first().waitFor();
    await page.getByLabel("URL の名前").fill(newSlug);
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("保存しました")).toBeVisible({ timeout: 15_000 });
    const redirected = await request.get(`/${slug}`, { maxRedirects: 0 });
    expect(redirected.status()).toBe(308);
    expect(redirected.headers()["location"]).toBe(`/${newSlug}`);

    // 切り替えて入る → 帯が出る → 出る
    await page.getByRole("button", { name: "この協会に切り替えて入る" }).click();
    await expect(page.getByText("運営管理者としてこの協会に入っています")).toBeVisible({ timeout: 15_000 });
    await page.goto(`/${newSlug}`);
    await expect(page.getByText(`運営管理者として E2E 協会 ${stamp} を表示中`)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "出る" }).click();
    await expect(page.getByText(/運営管理者として .* を表示中/)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    // 途中で止まっていても、スラッグから協会を探して消す
    if (!createdId) {
      const found = await owner.select({ id: associations.id }).from(associations).where(inArray(associations.slug, [slug, newSlug]));
      createdId = found[0]?.id ?? null;
    }
    if (createdId) {
      await owner.update(sessions).set({ enteredAssociationId: null, enteredUntil: null }).where(eq(sessions.enteredAssociationId, createdId));
      await withTenantOn(owner, createdId, async (tx) => {
        await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, createdId!));
        await tx.delete(associationAdminInvitations).where(eq(associationAdminInvitations.associationId, createdId!));
        await tx.delete(associationSlugHistory).where(eq(associationSlugHistory.associationId, createdId!));
      });
      await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.associationId, createdId));
      await owner.delete(mailLogs).where(eq(mailLogs.associationId, createdId));
      await owner.delete(associations).where(eq(associations.id, createdId));
    }
    await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.userId, user.id));
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await owner.delete(platformAdmins).where(eq(platformAdmins.userId, user.id));
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
  }
});
