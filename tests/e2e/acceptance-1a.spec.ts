import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { and, eq, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { members, sessions, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { normalizeName } from "../../src/lib/normalize";

// 1a の受け入れの通し確認（設計書 §12「動作確認の範囲」）:
// ログイン → チーム作成 → 選手を 4 人追加 → 選手を招待 を、WebKit 375×667 と Chromium 360×640 の両方で流し、
// 文字の拡大率 150%・200% のスクリーンショットを残す（らくらくスマートフォン・文字サイズ最大の端末の想定）
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

async function addPlayer(page: Page, teamId: string, name: string, year: string, day: string, sex: string) {
  await page.goto(`/sawara/teams/${teamId}/members/new`);
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("氏名").fill(name);
  await page.getByRole("radiogroup", { name: "生年月日の元号" }).getByText("西暦", { exact: true }).click();
  await page.getByLabel("年", { exact: true }).fill(year);
  await page.getByLabel("月", { exact: true }).fill("5");
  await page.getByLabel("日", { exact: true }).fill(day);
  await page.getByRole("radiogroup", { name: "性別" }).getByText(sex, { exact: true }).click();
  await page.getByRole("button", { name: "選手一覧に追加する" }).click();
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/members\\?added=1$`), { timeout: 15_000 });
}

// 文字の拡大率を上げた状態（ブラウザの「文字だけ大きくする」に相当。rem で組んでいるので :root の font-size で効く）
async function shotAtTextScale(page: Page, percent: number, name: string, testInfo: Parameters<Parameters<typeof test>[2]>[1]) {
  const style = await page.addStyleTag({ content: `:root { font-size: ${(16 * percent) / 100}px; }` });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const path = testInfo.outputPath(`${name}-${percent}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`${name}-${percent}`, { path, contentType: "image/png" });

  // はみ出しの確認: 主要なボタンが画面の幅に収まっている（横スクロールは html { overflow-x: hidden } で出ない）
  const viewport = page.viewportSize()!;
  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  await style.evaluate((el) => el.parentNode?.removeChild(el));
}

test("1a の通し: ログイン → チーム作成 → 選手を 4 人追加 → 招待。文字 150%・200% のスクリーンショット", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const email = `e2e-accept-${stamp}@example.com`;
  const playerEmail = `e2e-accept-player-${stamp}@example.com`;
  const tag = `E2E通し${stamp}`;
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date(), displayName: "代表の人" }).returning({ id: users.id });

  try {
    // 1. ログイン（確認番号は Mailpit から）
    await login(page, request, email, "/sawara");
    await expect(page).toHaveURL(/\/sawara$/, { timeout: 15_000 });

    // 2. チーム作成（チーム名だけ）
    await page.goto("/sawara/teams/new");
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("チーム名", { exact: true }).fill(`${tag} チーム`);
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page).toHaveURL(/\/sawara\/teams\/[0-9a-f-]+\?created=1$/, { timeout: 15_000 });
    const teamId = page.url().match(/\/teams\/([0-9a-f-]+)/)![1];

    // 3. 選手を 4 人追加
    await addPlayer(page, teamId, `${tag} 一郎`, "1965", "3", "男性");
    await addPlayer(page, teamId, `${tag} 二郎`, "1993", "4", "男性");
    await addPlayer(page, teamId, `${tag} 三子`, "1999", "5", "女性");
    await addPlayer(page, teamId, `${tag} 四子`, "2001", "6", "女性");
    await expect(page.getByRole("button", { name: "選手一覧から外す" })).toHaveCount(4);

    // 4. 招待（1 人目に送る）
    await page.locator("[data-hydrated]").first().waitFor();
    const ichiro = page.locator("li", { hasText: `${tag} 一郎` });
    await ichiro.getByRole("button", { name: "招待する" }).click();
    await ichiro.getByLabel("本人のメールアドレス").fill(playerEmail);
    await ichiro.getByRole("button", { name: "招待を送る" }).click();
    await expect(page.getByText(`${tag} 一郎さんに招待のメールを送ります`)).toBeVisible({ timeout: 15_000 });
    await expect(ichiro.getByText(/招待中（\d+月\d+日（[日月火水木金土]）まで）/)).toBeVisible({ timeout: 15_000 });

    // 5. 文字を大きくした状態のスクリーンショット（選手一覧とチームのページ）
    await shotAtTextScale(page, 150, "roster", testInfo);
    await shotAtTextScale(page, 200, "roster", testInfo);
    await page.goto(`/sawara/teams/${teamId}`);
    await shotAtTextScale(page, 200, "team", testInfo);
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(teams).where(eq(teams.createdBy, user.id));
      await tx.delete(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    });
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
  }
});
