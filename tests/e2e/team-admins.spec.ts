import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { eq, inArray } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { mailLogs, sessions, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { processMailQueue } from "../../src/lib/mail/queue";
import { createMailSender } from "../../src/lib/mail/sender";

// 代表者の委譲・解除とチームの無効化（設計書 §5.11）: 代表者を 1 人追加（招待 → 別ブラウザで承諾）→ 元の代表者が降りる → 残った代表者は降りられない → 無効にする
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

async function mailpitSearch(request: Req, query: string): Promise<{ Subject: string; ID: string }[]> {
  const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  return ((await res.json()) as { messages: { Subject: string; ID: string }[] }).messages ?? [];
}

async function latestCode(request: Req, email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const m = (await mailpitSearch(request, `to:${email} subject:確認番号`))[0]?.Subject.match(/(\d{6})$/);
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

test("代表者を 1 人追加 → 元の代表者が降りられる → 残った代表者は降りられない → 無効にする", async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const emailA = `e2e-admin-a-${stamp}@example.com`;
  const emailB = `e2e-admin-b-${stamp}@example.com`;
  const teamName = `E2E代表${stamp}`;
  const [a] = await owner.insert(users).values({ email: emailA, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [b] = await owner.insert(users).values({ email: emailB, emailVerifiedAt: new Date() }).returning({ id: users.id });

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const pageA = await ctxA.newPage();
    await login(pageA, request, emailA, "/sawara/teams/new");
    await expect(pageA).toHaveURL(/\/sawara\/teams\/new$/, { timeout: 15_000 });
    await pageA.locator("form[data-hydrated]").waitFor();
    await pageA.getByLabel("チーム名", { exact: true }).fill(teamName);
    await pageA.getByRole("button", { name: "登録する" }).click();
    await expect(pageA).toHaveURL(/\/sawara\/teams\/[0-9a-f-]+\?created=1$/, { timeout: 15_000 });
    const teamId = pageA.url().match(/\/teams\/([0-9a-f-]+)/)![1];

    // 代表者の画面: 1 人だけなので降りられない。メールアドレスで招待
    await pageA.getByRole("link", { name: "代表者" }).click();
    await expect(pageA).toHaveURL(new RegExp(`/teams/${teamId}/admins$`), { timeout: 15_000 });
    await expect(pageA.getByText("代表者が 1 人だけのときは外せません")).toBeVisible();
    await expect(pageA.getByRole("button", { name: "代表者を降りる" })).toHaveCount(0);
    await pageA.locator("[data-hydrated]").first().waitFor();
    await pageA.getByLabel("メールアドレスで招待する").fill(emailB);
    await pageA.getByRole("button", { name: "代表者として招待する" }).click();
    await expect(pageA.getByText("代表者としての招待のメールを送ります")).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByRole("heading", { name: "返事待ち" })).toBeVisible({ timeout: 15_000 });

    await processMailQueue(job, createMailSender());
    const mails = await mailpitSearch(request, `to:${emailB} subject:招待`);
    expect(mails[0]?.Subject).toBe(`【早良区協会】${teamName}からの招待`);
    const body = (await (await request.get(`${MAILPIT}/api/v1/message/${mails[0].ID}`)).json()) as { Text: string };
    expect(body.Text).toContain("代表者として招待されました");

    // B が承諾 → チームのページへ
    const pageB = await ctxB.newPage();
    await login(pageB, request, emailB, "/invitations");
    await expect(pageB.getByText(`${teamName}から代表者として招待されています`)).toBeVisible({ timeout: 15_000 });
    await pageB.locator("[data-hydrated]").first().waitFor();
    await pageB.getByRole("button", { name: "参加する" }).click();
    await expect(pageB).toHaveURL(new RegExp(`/sawara/teams/${teamId}$`), { timeout: 15_000 });
    await expect(pageB.getByRole("link", { name: "チーム情報を変える" })).toBeVisible();

    // A: 2 人になったので降りられる → マイページへ
    await pageA.reload();
    await expect(pageA.getByText("いまの代表者（2 人）")).toBeVisible({ timeout: 15_000 });
    await pageA.locator("[data-hydrated]").first().waitFor();
    await pageA.getByRole("button", { name: "代表者を降りる" }).click();
    await pageA.locator("li", { hasText: "（あなた）" }).getByRole("button", { name: "代表者を降りる" }).click();
    await expect(pageA).toHaveURL(/\/mypage$/, { timeout: 15_000 });
    await pageA.goto(`/sawara/teams/${teamId}/admins`);
    await expect(pageA.getByRole("heading", { level: 1 })).toHaveText("このページはチームの代表者だけが見られます");

    // B: 残った 1 人は降りられない → チームを無効にする
    await pageB.goto(`/sawara/teams/${teamId}/admins`);
    await expect(pageB.getByText("いまの代表者（1 人）")).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByRole("button", { name: "代表者を降りる" })).toHaveCount(0);
    await pageB.goto(`/sawara/teams/${teamId}`);
    await pageB.locator("[data-hydrated]").first().waitFor();
    await pageB.getByRole("button", { name: "このチームを無効にする" }).click();
    await pageB.getByRole("button", { name: "無効にする", exact: true }).click();
    await expect(pageB.getByText("このチームは無効になっています")).toBeVisible({ timeout: 15_000 });
    await pageB.getByRole("button", { name: "有効に戻す" }).click();
    await expect(pageB.getByText("このチームは無効になっています")).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
    await owner.delete(sessions).where(inArray(sessions.userId, [a.id, b.id]));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) => tx.delete(teams).where(eq(teams.createdBy, a.id)));
    await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, [emailA, emailB]));
    await owner.delete(users).where(inArray(users.id, [a.id, b.id]));
    await closeDb(owner);
    await closeDb(job);
  }
});
