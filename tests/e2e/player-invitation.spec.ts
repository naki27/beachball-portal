import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { mailLogs, members, sessions, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { processMailQueue } from "../../src/lib/mail/queue";
import { createMailSender } from "../../src/lib/mail/sender";
import { normalizeName } from "../../src/lib/normalize";

// 選手の招待（設計書 §5.15）: 代表者が招待 → Mailpit → 本人が別のブラウザでログイン → /invitations で参加 → 選手一覧が見え、ほかの人の生年月日は見えない
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

async function addPlayer(page: Page, teamId: string, name: string, year: string) {
  await page.goto(`/sawara/teams/${teamId}/members/new`);
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("氏名").fill(name);
  await page.getByRole("radiogroup", { name: "生年月日の元号" }).getByText("西暦", { exact: true }).click();
  await page.getByLabel("年", { exact: true }).fill(year);
  await page.getByLabel("月", { exact: true }).fill("5");
  await page.getByLabel("日", { exact: true }).fill("3");
  await page.getByRole("radiogroup", { name: "性別" }).getByText("男性", { exact: true }).click();
  await page.getByRole("button", { name: "選手一覧に追加する" }).click();
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/members\\?added=1$`), { timeout: 15_000 });
}

test("代表者が選手を招待し、本人が参加すると選手一覧が見える（ほかの人の生年月日は見えない）", async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-inviter-${stamp}@example.com`;
  const playerEmail = `e2e-player-${stamp}@example.com`;
  const tag = `E2E招待${stamp}`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date(), displayName: "代表の人" }).returning({ id: users.id });
  const [player] = await owner.insert(users).values({ email: playerEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    // 代表者: チームを作って 2 人追加し、太郎を招待
    const pageA = await ctxA.newPage();
    await login(pageA, request, adminEmail, "/sawara/teams/new");
    await expect(pageA).toHaveURL(/\/sawara\/teams\/new$/, { timeout: 15_000 });
    await pageA.locator("form[data-hydrated]").waitFor();
    await pageA.getByLabel("チーム名", { exact: true }).fill(`${tag} チーム`);
    await pageA.getByRole("button", { name: "登録する" }).click();
    await expect(pageA).toHaveURL(/\/sawara\/teams\/[0-9a-f-]+\?created=1$/, { timeout: 15_000 });
    const teamId = pageA.url().match(/\/teams\/([0-9a-f-]+)/)![1];
    await addPlayer(pageA, teamId, `${tag} 太郎`, "1990");
    await addPlayer(pageA, teamId, `${tag} 次郎`, "1995");
    await pageA.locator("[data-hydrated]").first().waitFor();
    const taro = pageA.locator("li", { hasText: `${tag} 太郎` });
    await taro.getByRole("button", { name: "招待する" }).click();
    await taro.getByLabel("本人のメールアドレス").fill(playerEmail);
    await taro.getByRole("button", { name: "招待を送る" }).click();
    await expect(pageA.getByText(`${tag} 太郎さんに招待のメールを送ります`)).toBeVisible({ timeout: 15_000 });
    await expect(taro.getByText(/招待中（\d+月\d+日（[日月火水木金土]）まで）/)).toBeVisible({ timeout: 15_000 });

    // 送信ジョブ → Mailpit の本文（協会のトップ・ログインに使うアドレス・期限。ログイン用リンクなし）
    await processMailQueue(job, createMailSender());
    const mails = await mailpitSearch(request, `to:${playerEmail} subject:招待`);
    expect(mails.length).toBe(1);
    expect(mails[0].Subject).toBe(`【早良区協会】${tag} チームからの招待`);
    const body = (await (await request.get(`${MAILPIT}/api/v1/message/${mails[0].ID}`)).json()) as { Text: string };
    expect(body.Text).toContain(`選手（${tag} 太郎）として招待されました`);
    expect(body.Text).toContain("代表者の 代表の人 さん");
    expect(body.Text).toContain(playerEmail);
    expect(body.Text).toContain("/sawara/");
    expect(body.Text).toMatch(/期限: \d+月\d+日（[日月火水木金土]）まで/);
    expect(body.Text).not.toMatch(/\/login/);

    // 本人: 別のブラウザでそのアドレスでログイン → /invitations → 参加する → 選手一覧
    const pageB = await ctxB.newPage();
    await login(pageB, request, playerEmail, "/invitations");
    await expect(pageB).toHaveURL(/\/invitations$/, { timeout: 15_000 });
    await expect(pageB.getByText(`${tag} チームから選手（${tag} 太郎）として招待されています`)).toBeVisible({ timeout: 15_000 });
    await pageB.locator("[data-hydrated]").first().waitFor();
    await pageB.getByRole("button", { name: "参加する" }).click();
    await expect(pageB).toHaveURL(new RegExp(`/sawara/teams/${teamId}/members$`), { timeout: 15_000 });
    const me = pageB.locator("li", { hasText: `${tag} 太郎` });
    await expect(me).toContainText("（あなた）");
    await expect(me).toContainText("1990年（平成2年）5月3日");
    await expect(me).toContainText("情報の修正はチームの代表者だけができます");
    const jiro = pageB.locator("li", { hasText: `${tag} 次郎` });
    await expect(jiro).toBeVisible();
    await expect(jiro).not.toContainText("1995年");
    await expect(pageB.getByRole("button", { name: "選手一覧から外す" })).toHaveCount(0);
    // 選手には「選手を追加する」も出ない
    await expect(pageB.getByRole("link", { name: "選手を追加する" })).toHaveCount(0);

    // マイページに「選手として所属するチーム」
    await pageB.goto("/mypage");
    await expect(pageB.getByRole("region", { name: "早良区協会" }).getByRole("link", { name: `${tag} チーム` })).toBeVisible({ timeout: 15_000 });

    // 代表者の画面では「本人がログインできます」
    await pageA.reload();
    await expect(pageA.locator("li", { hasText: `${tag} 太郎` })).toContainText("本人がログインできます", { timeout: 15_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
    await owner.delete(sessions).where(inArray(sessions.userId, [admin.id, player.id]));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(teams).where(eq(teams.createdBy, admin.id));
      await tx.delete(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    });
    await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, [adminEmail, playerEmail]));
    await owner.delete(users).where(inArray(users.id, [admin.id, player.id]));
    await closeDb(owner);
    await closeDb(job);
  }
});
