import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { and, eq, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { members, sessions, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { normalizeName } from "../../src/lib/normalize";

// 個人登録と「自分を選手として登録する」（設計書 §5.11）: 個人で登録 → マイページに「あなたの登録情報」 → チームに自分を選手として（確認だけ）
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

test("個人で登録 → マイページに「あなたの登録情報」→ 自分のチームに自分を選手として登録（確認だけ）", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const email = `e2e-individual-${stamp}@example.com`;
  const name = `E2E個人${stamp} 花子`;
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });

  try {
    await login(page, request, email, "/sawara/teams/new?kind=individual");
    await expect(page).toHaveURL(/\/sawara\/teams\/new\?kind=individual$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("個人で登録");
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("氏名").fill(name);
    await page.getByLabel("年", { exact: true }).fill("60");
    await page.getByLabel("月", { exact: true }).fill("8");
    await page.getByLabel("日", { exact: true }).fill("8");
    await page.getByRole("radiogroup", { name: "性別" }).getByText("女性", { exact: true }).click();
    await page.getByRole("button", { name: "個人で登録する" }).click();
    await expect(page).toHaveURL(/\/sawara\/teams\/[0-9a-f-]+\?created=1$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("あなたの登録情報");
    await expect(page.getByText("1985年（昭和60年）8月8日", { exact: false })).toBeVisible();
    await expect(page).toHaveTitle("登録情報｜早良区協会");

    // マイページに出る。2 つ目の個人登録はできない
    await page.goto("/mypage");
    const sawara = page.getByRole("region", { name: "早良区協会" });
    await expect(sawara.getByRole("heading", { level: 3, name: "あなたの登録情報" })).toBeVisible({ timeout: 15_000 });
    await expect(sawara.getByRole("link", { name })).toBeVisible();
    await expect(sawara.getByRole("link", { name: "個人で登録する" })).toHaveCount(0);
    await page.goto("/sawara/teams/new?kind=individual");
    await expect(page.getByText("個人の登録はすでにあります")).toBeVisible({ timeout: 15_000 });

    // チームを作り、「自分を選手として登録する」→ 紐づいた人物があるので確認だけ
    await page.goto("/sawara/teams/new");
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("チーム名", { exact: true }).fill(`E2E個人${stamp} のチーム`);
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page).toHaveURL(/\/sawara\/teams\/[0-9a-f-]+\?created=1$/, { timeout: 15_000 });
    const teamId = page.url().match(/\/teams\/([0-9a-f-]+)/)![1];
    await page.goto(`/sawara/teams/${teamId}/members/new`);
    await page.getByRole("link", { name: "自分を選手として登録する" }).click();
    await expect(page).toHaveURL(new RegExp(`/members/new\\?self=1$`), { timeout: 15_000 });
    await expect(page.getByText(name)).toBeVisible();
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByRole("button", { name: "選手一覧に追加する" }).click();
    await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/members\\?added=1$`), { timeout: 15_000 });
    await expect(page.locator("li", { hasText: name })).toContainText("（あなた）");

    // 協会内で 1 アカウント = 1 人物
    const rows = await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
      tx.select({ id: members.id }).from(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), eq(members.userId, user.id))),
    );
    expect(rows).toHaveLength(1);
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(teams).where(eq(teams.createdBy, user.id));
      await tx.delete(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), like(members.nameNormalized, `${normalizeName(`E2E個人${stamp}`)}%`)));
    });
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
  }
});
