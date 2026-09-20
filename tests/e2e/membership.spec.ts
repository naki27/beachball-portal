import { expect, type Page } from "@playwright/test";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import {
  associationAdmins,
  mailLogs,
  members,
  membershipDeclarations,
  membershipPeriods,
  memberships,
  sessions,
  teams,
  users,
} from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { test } from "./fixtures";

// 年度更新の申告（設計書 §5.12・D-05）:
// 運営が受付を開始 → 代表者のトップに案内 → 選手を選んで申告 → 運営が承認 → チーム管理に「協会員」
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

async function logout(page: Page) {
  await page.goto("/mypage");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/$|\/login/, { timeout: 20_000 });
}

async function login(page: Page, request: Req, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "確認番号を送る" }).click();
  await expect(page).toHaveURL(/\/login\/code/, { timeout: 15_000 });
  await page.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email));
}

// 「今年度」を受付期間の中に入れるため、受付は今日を含む期間で開く
function todayInTokyo(): { year: number; month: number; day: number } {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date()).split("-").map(Number);
  return { year, month, day };
}

test("受付を開いて、代表者が申告し、運営が承認する", async ({ page, request }, testInfo) => {
  test.setTimeout(200_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-mb-admin-${stamp}@example.com`;
  const repEmail = `e2e-mb-rep-${stamp}@example.com`;
  const teamName = `E2E年度更新${stamp}`;
  const playerName = `E2E選手${stamp}`;

  const made = await owner
    .insert(users)
    .values([
      { email: adminEmail, emailVerifiedAt: new Date() },
      { email: repEmail, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  const [admin] = made;
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: admin.id }),
  );

  const today = todayInTokyo();
  // 今年度（4 月開始）。3 月なら前年の年度になる
  const year = today.month >= 4 ? today.year : today.year - 1;

  try {
    // 1. 運営が受付を開く（今日を含む期間）
    await login(page, request, adminEmail, "/sawara/admin/memberships");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("協会員の管理", { timeout: 20_000 });
    await page.locator("input#new-year").waitFor();
    await page.getByLabel("年度").fill(String(year));
    await page.getByLabel("受付の開始日").fill(`${year}-04-01`);
    await page.getByLabel("受付の締切日").fill(`${year + 1}-03-31`);
    await page.getByRole("button", { name: "受付を始める" }).click();
    await expect(page.getByText(`${year}年度の受付を始めました`)).toBeVisible({ timeout: 20_000 });

    // 2. 代表者がチームと選手を作る（協会員の登録をするチーム）
    await logout(page);
    await login(page, request, repEmail, "/sawara/teams/new");
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("チーム名", { exact: true }).fill(teamName);
    await page.locator("label").filter({ hasText: "協会員の登録をするチーム" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page).toHaveURL(/\/sawara\/teams\/[0-9a-f-]+\?created=1$/, { timeout: 20_000 });
    const teamId = page.url().match(/\/teams\/([0-9a-f-]+)/)![1];
    const teamUrl = `/sawara/teams/${teamId}`;

    await page.goto(`${teamUrl}/members/new`);
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("氏名").fill(playerName);
    await page.getByRole("radiogroup", { name: "生年月日の元号" }).getByText("平成", { exact: true }).click();
    await page.getByLabel("年", { exact: true }).fill("2");
    await page.getByLabel("月", { exact: true }).fill("5");
    await page.getByLabel("日", { exact: true }).fill("5");
    await page.getByRole("radiogroup", { name: "性別" }).getByText("男性", { exact: true }).click();
    await page.getByRole("button", { name: "選手一覧に追加する" }).click();
    await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/members\\?added=1$`), { timeout: 20_000 });

    // 3. トップの「あなたのやること」に案内が出る
    await page.goto("/sawara");
    const todos = page.getByRole("region", { name: "あなたのやること" });
    await expect(todos.getByRole("link", { name: new RegExp(`${year}年度も登録する人を選んでください`) })).toBeVisible({ timeout: 20_000 });
    await todos.getByRole("link", { name: new RegExp(`${year}年度も登録する人を選んでください`) }).click();

    // 4. 申告の画面。チェックを入れると人数が変わる
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${year}年度も登録する人を選ぶ`, { timeout: 20_000 });
    await expect(page.getByText(`1人中0人を${year}年度も登録します`)).toBeVisible();
    await page.locator("label").filter({ hasText: playerName }).getByRole("checkbox").check();
    await expect(page.getByText(`1人中1人を${year}年度も登録します`)).toBeVisible();
    await page.getByRole("button", { name: "この内容で送る" }).click();
    await expect(page.getByText(`${year}年度の申告を送りました`)).toBeVisible({ timeout: 20_000 });
    // 送信後の読み直し（router.refresh）が終わるのを待つ。終わると状態が「運営の確認待ち」になる
    await expect(page.getByText("運営の確認待ち")).toBeVisible({ timeout: 20_000 });

    // 5. チーム管理の画面に「運営の確認待ち」が出る
    await page.goto(`${teamUrl}/members`);
    await expect(page.getByText("今年度: 運営の確認待ち")).toBeVisible({ timeout: 20_000 });

    // 6. 運営が承認する
    await logout(page);
    await login(page, request, adminEmail, "/sawara/admin/memberships");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("協会員の管理", { timeout: 20_000 });
    const pending = page.getByRole("region", { name: "承認待ちの申告" });
    await expect(pending.getByText(teamName)).toBeVisible({ timeout: 20_000 });
    await expect(pending.getByText(playerName)).toBeVisible();
    await page.getByRole("button", { name: /承認待ちのすべて/ }).click();
    await expect(page.getByText(/を承認しました/)).toBeVisible({ timeout: 20_000 });

    // 7. 代表者の画面で「協会員」になる
    await logout(page);
    await login(page, request, repEmail, `/sawara/teams/${teamId}/members`);
    await expect(page.getByText(`今年度: 協会員（${year}年度）`)).toBeVisible({ timeout: 20_000 });
  } finally {
    const ids = made.map((u) => u.id);
    await owner.delete(sessions).where(inArray(sessions.userId, ids));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      const teamRows = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.associationId, SAWARA_ASSOCIATION_ID), like(teams.name, `${teamName}%`)));
      const teamIds = teamRows.map((t) => t.id);
      if (teamIds.length > 0) {
        await tx.delete(memberships).where(inArray(memberships.teamId, teamIds));
        await tx.delete(membershipDeclarations).where(inArray(membershipDeclarations.teamId, teamIds));
        await tx.delete(teams).where(inArray(teams.id, teamIds));
      }
      await tx.delete(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), like(members.name, `${playerName}%`)));
      await tx.delete(membershipPeriods).where(eq(membershipPeriods.associationId, SAWARA_ASSOCIATION_ID));
      await tx.delete(associationAdmins).where(inArray(associationAdmins.userId, ids));
    });
    await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%-${stamp}@example.com`));
    await owner.delete(users).where(inArray(users.id, ids));
    await closeDb(owner);
  }
});
