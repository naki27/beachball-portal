import { expect, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, mailLogs, members, membershipDeclarations, membershipPeriods, memberships, sessions, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { ANONYMOUS, type Principal } from "../../src/lib/authz";
import { fiscalYear, todayInTokyo } from "../../src/lib/date";
import { addPlayer } from "../../src/lib/teams/roster";
import { registerTeam } from "../../src/lib/teams/teams";
import { test } from "./fixtures";

// 年度更新（設計書 §5.12・1d の受け入れ条件）: 管理者が受付を開始 → 代表者のトップに案内 → 申告 → 管理者が承認 → 選手一覧の「今年度」
// 受付期間中、昨年度の会員で申告がまだの人は「更新の受付中（昨年度は協会員）」と出る（D-05）
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

test("受付開始 → 案内 → 申告 → 承認 → 選手一覧の今年度（375×667）", async ({ page, request, browser }, testInfo) => {
  test.setTimeout(240_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-ms-admin-${stamp}@example.com`;
  const repEmail = `e2e-ms-rep-${stamp}@example.com`;
  const teamName = `E2E年度更新${stamp}`;
  const year = fiscalYear(todayInTokyo(), 4);
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [rep] = await owner.insert(users).values({ email: repEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: admin.id }));
  const repActor: Principal & { userId: string } = { ...ANONYMOUS, userId: rep.id, sessionState: "active" };
  const memberIds: string[] = [];
  let teamId = "";

  try {
    teamId = (await registerTeam(app, S, rep.id, { name: teamName, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: true })).id;
    const lastYear = await addPlayer(app, repActor, S, teamId, { name: `${teamName} 昨年度`, kana: "", birthDate: "1980-01-01", sex: "male" });
    const newcomer = await addPlayer(app, repActor, S, teamId, { name: `${teamName} 新人`, kana: "", birthDate: "1995-01-01", sex: "female" });
    memberIds.push(lastYear.memberId, newcomer.memberId);
    // 今年度の受付は、前の実行の残りがあれば消してから始める。昨年度の会員を 1 人作る
    await withTenantOn(owner, S, async (tx) => {
      await tx.delete(membershipPeriods).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, year)));
      await tx.insert(memberships).values({ associationId: S, memberId: lastYear.memberId, year: year - 1, status: "approved", source: "renewal" });
    });

    // 管理者: 受付を開始する（開始は一覧と別のページ・U-04）
    await login(page, request, adminEmail, `/${SAWARA_SLUG}/admin/memberships`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("会員の管理（年度更新）", { timeout: 20_000 });
    await page.getByRole("link", { name: "受付を開始する" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("受付を開始する", { timeout: 20_000 });
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByLabel("対象年度（西暦）").fill(String(year));
    await page.getByLabel("受付の開始日").fill(dayFrom(-1));
    await page.getByLabel("受付の締切日").fill(dayFrom(10));
    await page.getByRole("button", { name: "受付を開始する" }).click();
    await expect(page.getByText(`${year}年度の受付を開始しました`)).toBeVisible({ timeout: 20_000 });

    // 代表者（別のブラウザ）: トップの案内 → 選手一覧は「更新の受付中」 → 申告
    const repContext = await browser.newContext();
    const repPage = await repContext.newPage();
    try {
      await login(repPage, repContext.request, repEmail, `/${SAWARA_SLUG}`);
      const todo = repPage.getByRole("link", { name: new RegExp(`${teamName}: ${year}年度も登録する人を選んでください`) });
      await expect(todo).toBeVisible({ timeout: 20_000 });

      await repPage.goto(`/${SAWARA_SLUG}/teams/${teamId}/members`);
      await expect(repPage.getByText("更新の受付中（昨年度は協会員）")).toBeVisible({ timeout: 20_000 });
      await expect(repPage.getByText("協会員ではない")).toBeVisible();

      await repPage.goto(`/${SAWARA_SLUG}/teams/${teamId}/membership`);
      await expect(repPage.getByRole("heading", { level: 1 })).toHaveText(`${year}年度も登録する人を選ぶ`, { timeout: 20_000 });
      // 申告フォームと「新しい選手を追加する」の 2 つの form があるので、先頭（申告フォーム）を待つ
      await repPage.locator("form[data-hydrated]").first().waitFor();
      await expect(repPage.getByText(`2人中1人を${year}年度も登録します`)).toBeVisible();
      // 注意書きの「（昨年度の会員だけ）」と区別するため完全一致で
      await expect(repPage.getByText("昨年度の会員", { exact: true })).toBeVisible();
      const overflow = await repPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await repPage.getByRole("checkbox", { name: new RegExp(`${teamName} 新人`) }).check();
      await expect(repPage.getByText(`2人中2人を${year}年度も登録します`)).toBeVisible();
      await repPage.getByRole("button", { name: "申告を送る" }).click();
      await expect(repPage.getByText(`${year}年度の申告を送りました`).first()).toBeVisible({ timeout: 20_000 });
      // 送信後の router.refresh() が終わる（サーバーが「最終更新」つきで描き直す）のを待ってから移動する（移動がぶつからないように）
      await expect(repPage.getByText(/最終更新: /)).toBeVisible({ timeout: 20_000 });

      await repPage.goto(`/${SAWARA_SLUG}/teams/${teamId}/members`);
      await expect(repPage.getByText("運営の確認待ち").first()).toBeVisible({ timeout: 20_000 });

      // 管理者: 申告の状況 → まとめて承認
      await page.goto(`/${SAWARA_SLUG}/admin/memberships/${year}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${year}年度の申告の状況`, { timeout: 20_000 });
      await expect(page.getByText(teamName).first()).toBeVisible();
      await page.locator("[data-hydrated]").first().waitFor();
      await page.getByRole("button", { name: /運営の確認待ちの \d+ 人をまとめて承認する/ }).click();
      await expect(page.getByText(/\d+ 人を承認しました/)).toBeVisible({ timeout: 20_000 });

      // 代表者: 選手一覧が「協会員（YYYY年度）」になる
      await repPage.goto(`/${SAWARA_SLUG}/teams/${teamId}/members`);
      await expect(repPage.getByText(`協会員（${year}年度）`).first()).toBeVisible({ timeout: 20_000 });
      await expect(repPage.getByText("更新の受付中（昨年度は協会員）")).toHaveCount(0);
    } finally {
      await repContext.close();
    }
  } finally {
    await withTenantOn(owner, S, async (tx) => {
      if (memberIds.length > 0) await tx.delete(memberships).where(and(eq(memberships.associationId, S), inArray(memberships.memberId, memberIds)));
      if (teamId) await tx.delete(membershipDeclarations).where(and(eq(membershipDeclarations.associationId, S), eq(membershipDeclarations.teamId, teamId)));
      await tx.delete(membershipPeriods).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, year)));
      await tx.delete(teams).where(and(eq(teams.associationId, S), eq(teams.createdBy, rep.id)));
      if (memberIds.length > 0) await tx.delete(members).where(and(eq(members.associationId, S), inArray(members.id, memberIds)));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, [adminEmail, repEmail]));
    await owner.delete(sessions).where(inArray(sessions.userId, [admin.id, rep.id]));
    await owner.delete(users).where(inArray(users.id, [admin.id, rep.id]));
    await closeDb(owner);
    await closeDb(app);
  }
});
