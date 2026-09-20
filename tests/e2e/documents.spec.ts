import { expect, type Page } from "@playwright/test";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, sessions, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { test } from "./fixtures";

// 大会資料の掲示（設計書 §5.9・C-01 / C-02 / C-03）:
// 管理者が PDF をアップロード → 未ログインで大会ページから開ける → 非公開にすると 404
// 拡張子だけ .pdf にした画像が拒まれることも見る（受け入れ条件）
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

// 小さな PDF（先頭が %PDF- なので検証を通る）と、拡張子だけ .pdf にした PNG
const pdfBytes = (text: string) => Buffer.from(`%PDF-1.7\n% ${text}\n%%EOF\n`, "utf8");
const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

test("管理者が大会冊子を上げ、未ログインで開ける。非公開にすると 404", async ({ page, request, context }, testInfo) => {
  test.setTimeout(180_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-doc-admin-${stamp}@example.com`;
  const name = `E2E資料の大会${stamp}`;
  const title = `E2E大会冊子${stamp}`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: admin.id }),
  );

  try {
    // 大会を 1 つ作って受付中にする
    await login(page, request, adminEmail, "/sawara/admin/tournaments/new");
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("大会名").fill(name);
    await page.getByLabel("開催日（任意）").fill("2027-03-28");
    await page.getByLabel("会場（任意）").fill("早良体育館");
    await page.getByLabel("締切日", { exact: true }).fill("2027-02-28");
    await page.getByRole("button", { name: "大会を作る" }).click();
    await expect(page.getByText("大会を作りました")).toBeVisible({ timeout: 20_000 });
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("公開の状態").selectOption("open");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("保存しました")).toBeVisible({ timeout: 15_000 });
    const tournamentId = new URL(page.url()).pathname.split("/").pop() ?? "";

    // 資料の画面へ。注意書きが出ている
    await page.getByRole("link", { name: "大会の資料（PDF）" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("大会の資料", { timeout: 20_000 });
    await expect(page.getByText("個人情報が含まれていないか確認してください")).toBeVisible();

    // 拡張子だけ .pdf にした画像は拒まれる
    await page.getByLabel("PDF のファイル").setInputFiles({ name: "偽物.pdf", mimeType: "application/pdf", buffer: pngBytes() });
    await page.getByLabel("タイトル", { exact: true }).fill(title);
    await page.getByRole("button", { name: "追加する" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "PDF として読めないファイルです" })).toBeVisible({ timeout: 20_000 });

    // ちゃんとした PDF は上がる
    await page.getByLabel("PDF のファイル").setInputFiles({ name: "冊子.pdf", mimeType: "application/pdf", buffer: pdfBytes(title) });
    await page.getByRole("button", { name: "追加する" }).click();
    await expect(page.getByText(`${title}を追加しました`)).toBeVisible({ timeout: 20_000 });
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toContainText("公開中");
    await expect(row).toContainText("大会冊子");

    // 未ログインの人（別のブラウザ文脈）が大会ページから開ける
    const guest = await context.browser()?.newContext({ viewport: page.viewportSize() ?? undefined });
    if (!guest) throw new Error("ゲスト用の文脈が作れない");
    const guestPage = await guest.newPage();
    try {
      await guestPage.goto(`/sawara/tournaments/${tournamentId}`);
      const documents = guestPage.getByRole("region", { name: "大会の資料" });
      await expect(documents.getByRole("link", { name: new RegExp(title) })).toBeVisible({ timeout: 20_000 });
      await expect(documents).toContainText("大会冊子・PDF");

      // 押すと「開いています…」が出る（PDF が開くまで待たされるので、押したことが分かるようにする）
      const link = documents.getByRole("link", { name: new RegExp(title) });
      const href = (await link.getAttribute("href")) ?? "";
      await link.click();
      await expect(documents).toContainText("開いています…");

      // アプリの URL は公開用の URL（ローカルは /dev-files/…）へ 302 で送る。
      // PDF をブラウザで表示できるかは環境によるので、応答だけを見る
      const redirect = await guestPage.request.get(href, { maxRedirects: 0 });
      expect(redirect.status()).toBe(302);
      const location = redirect.headers()["location"] ?? "";
      expect(location).toMatch(/^\/dev-files\/documents\/[0-9a-f]{32}\.pdf$/);
      const direct = await guestPage.request.get(location);
      expect(direct.status()).toBe(200);
      expect(direct.headers()["content-type"]).toContain("application/pdf");

      // トップの「新しい資料」にも出る
      await guestPage.goto("/sawara");
      await expect(guestPage.getByRole("region", { name: "新しい資料" }).getByRole("link", { name: new RegExp(title) })).toBeVisible({
        timeout: 20_000,
      });

      // 非公開にすると、大会ページから消えてアプリの URL も 404
      await page.getByRole("button", { name: "非公開にする" }).click();
      await expect(page.getByText(`${title}を非公開にしました`)).toBeVisible({ timeout: 20_000 });
      const after = await guestPage.request.get(href, { maxRedirects: 0 });
      expect(after.status()).toBe(404);
      // 公開用の置き場からもファイルが消えている
      expect((await guestPage.request.get(location)).status()).toBe(404);
      await guestPage.goto(`/sawara/tournaments/${tournamentId}`);
      await expect(guestPage.getByRole("region", { name: "大会の資料" })).toHaveCount(0);
    } finally {
      await guest.close();
    }
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, admin.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      // 大会を消すと資料の行も cascade で消える（保存先のファイルは日次ジョブ ⑥ の後始末で消える）
      await tx.delete(tournaments).where(and(eq(tournaments.associationId, SAWARA_ASSOCIATION_ID), like(tournaments.name, `${name}%`)));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(users).where(inArray(users.id, [admin.id]));
    await closeDb(owner);
  }
});
