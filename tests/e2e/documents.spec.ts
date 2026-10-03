import { expect, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, sessions, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { editDocument } from "../../src/lib/admin/documents";
import { createTournament } from "../../src/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "../../src/lib/authz";
import { todayInTokyo } from "../../src/lib/date";
import { test } from "./fixtures";

// 大会資料（設計書 §5.9・1c の受け入れ条件）: 管理者が PDF を上げる → ログアウトした人が大会ページから開く（375×667）
// → 非公開にするとアプリの URL が 404。拡張子だけ .pdf の画像は拒否される
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];
const S = SAWARA_ASSOCIATION_ID;

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

function dayFrom(days: number): string {
  const today = todayInTokyo();
  return new Date(Date.UTC(today.year, today.month - 1, today.day + days)).toISOString().slice(0, 10);
}

const pdfBytes = (marker: string) => Buffer.from(`%PDF-1.7\n% ${marker}\n${"x".repeat(200)}\n%%EOF\n`);
const pngBytes = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);

test("管理者が PDF を上げ、未ログインの人が大会ページから開く。非公開にすると 404", async ({ page, request, browser }, testInfo) => {
  test.setTimeout(180_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-doc-admin-${stamp}@example.com`;
  const name = `E2E資料${stamp}`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: admin.id }));
  const actor: Principal & { userId: string } = { ...ANONYMOUS, userId: admin.id, sessionState: "active" };

  try {
    const tournament = await createTournament(app, actor, S, {
      name,
      eventDate: dayFrom(60),
      ageReferenceDate: dayFrom(60),
      venue: "早良体育館",
      description: "",
      entryStartDate: dayFrom(-5),
      entryEndDate: dayFrom(10),
      teamSizeMin: "4",
      teamSizeMax: "7",
      maxEntries: "",
      status: "open",
    });
    const documentsUrl = `/${SAWARA_SLUG}/admin/tournaments/${tournament.id}/documents`;

    // 管理者: 拡張子だけ .pdf の画像は拒否 → 本物の PDF を追加（追加は一覧と別のページ・U-04）
    await login(page, request, adminEmail, documentsUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("大会資料", { timeout: 20_000 });
    await page.getByRole("link", { name: "資料を追加する" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("資料を追加する", { timeout: 20_000 });
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByLabel("PDF ファイル").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: pngBytes() });
    await page.getByLabel("タイトル", { exact: true }).fill(`${name} 偽物`);
    await page.getByRole("button", { name: "アップロードする" }).click();
    await expect(page.getByText("中身が PDF ではありません")).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("PDF ファイル").setInputFiles({ name: "booklet.pdf", mimeType: "application/pdf", buffer: pdfBytes("booklet") });
    await page.getByLabel("タイトル", { exact: true }).fill(`${name} 大会冊子`);
    await page.getByRole("button", { name: "アップロードする" }).click();
    await expect(page.getByText(`「${name} 大会冊子」を追加しました`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("大会ページと同じ URL で開く")).toBeVisible({ timeout: 20_000 });

    // 別のブラウザ（未ログイン）: 大会ページ → 資料の一覧 → 開く。375×667 で横にはみ出さない
    const visitor = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const visitorPage = await visitor.newPage();
    try {
      await visitorPage.goto(`/${SAWARA_SLUG}/tournaments/${tournament.id}`);
      await expect(visitorPage.getByRole("heading", { name: "大会資料" })).toBeVisible({ timeout: 20_000 });
      const overflow = await visitorPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const link = visitorPage.getByRole("link", { name: new RegExp(`${name} 大会冊子`) });
      const href = await link.getAttribute("href");
      expect(href).toMatch(new RegExp(`^/${SAWARA_SLUG}/tournaments/${tournament.id}/documents/[0-9a-f-]{36}$`));
      // 押すと「開いています…」が出る。ヘッドレスのブラウザは PDF を表示せずダウンロードにすることがあり、
      // 新しいタブ（popup）が来ないこともあるので、タブは来たら閉じるだけにする
      const popupPromise = visitorPage.waitForEvent("popup", { timeout: 10_000 }).catch(() => null);
      await link.click();
      await expect(visitorPage.getByText("開いています…")).toBeVisible();
      const popup = await popupPromise;
      if (popup) await popup.close().catch(() => undefined);

      // アプリの URL は 302 で公開用へ。公開用は PDF 本体（期限なし）
      const redirect = await visitor.request.get(href as string, { maxRedirects: 0 });
      expect(redirect.status()).toBe(302);
      const location = redirect.headers()["location"];
      expect(location).toContain("/dev-files/documents/");
      const file = await visitor.request.get(location);
      expect(file.status()).toBe(200);
      expect(file.headers()["content-type"]).toContain("application/pdf");
      expect(file.headers()["content-disposition"]).toContain("inline");
      expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");

      // トップの「新しい資料」にも出る
      await visitorPage.goto(`/${SAWARA_SLUG}`);
      await expect(visitorPage.getByRole("heading", { name: "新しい資料" })).toBeVisible({ timeout: 20_000 });
      await expect(visitorPage.getByRole("link", { name: new RegExp(`${name} 大会冊子`) })).toBeVisible();

      // 非公開にすると、アプリの URL は 404 になり、一覧からも消える
      const documentId = (href as string).split("/").pop() as string;
      await editDocument(app, actor, S, tournament.id, documentId, { docType: "大会冊子", title: `${name} 大会冊子`, isPublic: false });
      expect((await visitor.request.get(href as string, { maxRedirects: 0 })).status()).toBe(404);
      await visitorPage.goto(`/${SAWARA_SLUG}/tournaments/${tournament.id}`);
      await expect(visitorPage.getByRole("heading", { level: 1 })).toHaveText(name, { timeout: 20_000 });
      await expect(visitorPage.getByRole("heading", { name: "大会資料" })).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  } finally {
    await withTenantOn(owner, S, async (tx) => {
      // 大会を消すと資料の行も cascade で消える（ファイルは日次ジョブの後始末で消える）
      await tx.delete(tournaments).where(and(eq(tournaments.associationId, S), eq(tournaments.createdBy, admin.id)));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(sessions).where(eq(sessions.userId, admin.id));
    await owner.delete(users).where(inArray(users.id, [admin.id]));
    await closeDb(owner);
    await closeDb(app);
  }
});
