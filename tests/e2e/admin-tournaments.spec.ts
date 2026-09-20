import { expect, type Page } from "@playwright/test";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, sessions, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { test } from "./fixtures";

// 大会の管理（設計書 §4.2 #13・§5.4・B-04）: テナント管理者が大会を作り、内容を直して「受付中」にする
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

test("テナント管理者が大会を作り、直して受付中にする", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-tn-admin-${stamp}@example.com`;
  const name = `E2E大会${stamp}`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: admin.id }),
  );

  try {
    await login(page, request, adminEmail, "/sawara/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("早良区協会の管理", { timeout: 15_000 });
    await page.getByRole("link", { name: "大会の管理" }).click();
    await expect(page).toHaveURL(/\/sawara\/admin\/tournaments$/, { timeout: 15_000 });

    // 作る: 開催日を入れると年齢の基準日に同じ日が入る
    await page.getByRole("link", { name: "大会を作る" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("大会を作る", { timeout: 15_000 });
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("大会名").fill(name);
    await page.getByLabel("開催日（任意）").fill("2026-11-23");
    await expect(page.getByLabel("年齢の基準日")).toHaveValue("2026-11-23");
    await page.getByLabel("会場（任意）").fill("早良体育館");
    await page.getByLabel("申し込みの開始日（任意）").fill("2026-09-01");
    await page.getByLabel("締切日").fill("2026-09-30");
    await page.getByRole("button", { name: "大会を作る" }).click();

    // 作ったあとは編集の画面。状態は「準備中」
    await expect(page.getByText("大会を作りました")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByLabel("公開の状態")).toHaveValue("draft");

    // 直す: 参加人数の上限を下限より小さくすると、その欄に理由が出て保存されない
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("参加人数の上限").fill("3");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("参加人数の上限は下限以上にしてください")).toBeVisible();

    // 上限を直し、状態を「受付中」にして保存
    await page.getByLabel("参加人数の上限").fill("8");
    await page.getByLabel("申し込みの上限（任意）").fill("16");
    await page.getByLabel("公開の状態").selectOption("open");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("保存しました")).toBeVisible({ timeout: 15_000 });

    // 一覧に「受付中」で出る
    await page.getByRole("link", { name: "← 大会の管理" }).click();
    await expect(page).toHaveURL(/\/sawara\/admin\/tournaments$/, { timeout: 15_000 });
    const row = page.getByRole("link", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("受付中（公開する）");
    await expect(row).toContainText("締切 9月30日（水）まで");

    // 保存された値が画面に戻る（締切は日付のまま）
    await row.click();
    await expect(page.getByLabel("締切日")).toHaveValue("2026-09-30", { timeout: 15_000 });
    await expect(page.getByLabel("参加人数の上限")).toHaveValue("8");
    await expect(page.getByLabel("申し込みの上限（任意）")).toHaveValue("16");
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, admin.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(tournaments).where(and(eq(tournaments.associationId, SAWARA_ASSOCIATION_ID), like(tournaments.name, `${name}%`)));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(users).where(inArray(users.id, [admin.id]));
    await closeDb(owner);
  }
});
