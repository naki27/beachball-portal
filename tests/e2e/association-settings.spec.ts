import { expect, type Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, associations, sessions, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { test } from "./fixtures";

// 協会の設定（K-02・ADR 0032）: テナント管理者が「個人で登録する」を止めると、入口が消えて URL も 404 になる
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

async function login(page: Page, request: Req, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "確認番号を送る" }).click();
  await expect(page).toHaveURL(/\/login\/code/, { timeout: 15_000 });
  await page.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email));
}

test("テナント管理者が「個人で登録する」を止めると、入口が消えて URL は 404 になる", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const adminEmail = `e2e-assoc-admin-${testInfo.workerIndex}-${Date.now()}@example.com`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: admin.id }),
  );

  try {
    await login(page, request, adminEmail, "/sawara/admin/association");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("協会の設定", { timeout: 15_000 });
    // いまは受け付けているので、協会のトップに入口がある
    await expect(page.getByText("いまの設定: 受け付ける")).toBeVisible();

    await page.getByRole("button", { name: "受け付けないようにする" }).click();
    await expect(page.getByText("個人での登録を止めました")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("いまの設定: 受け付けない")).toBeVisible({ timeout: 15_000 });

    // 協会のトップからリンクが消え、URL を直に開くと 404
    await page.goto("/sawara");
    await expect(page.getByRole("link", { name: "個人で登録する" })).toHaveCount(0);
    const blocked = await page.goto("/sawara/teams/new?kind=individual");
    expect(blocked?.status()).toBe(404);

    // 戻せば、また入口が出る
    await page.goto("/sawara/admin/association");
    await page.getByRole("button", { name: "受け付けるようにする" }).click();
    await expect(page.getByText("いまの設定: 受け付ける")).toBeVisible({ timeout: 15_000 });
    await page.goto("/sawara");
    await expect(page.getByRole("link", { name: "個人で登録する" })).toBeVisible();
  } finally {
    await owner.update(associations).set({ individualRegistrationEnabled: true }).where(eq(associations.id, SAWARA_ASSOCIATION_ID));
    await owner.delete(sessions).where(eq(sessions.userId, admin.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) => tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id)));
    await owner.delete(users).where(inArray(users.id, [admin.id]));
    await closeDb(owner);
  }
});
