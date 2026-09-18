import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, members, sessions, teamAdmins, teamMembers, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { normalizeName } from "../../src/lib/normalize";

// 管理画面: チームとメンバー（設計書 §4.2 #15・#16）: テナント管理者がチームを探して代表者を付け替える → メンバーを探して誤登録の行を消す
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

test("テナント管理者がチームを探して代表者を付け替え、メンバーの誤登録の行を消す", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-tenant-admin-${stamp}@example.com`;
  const captainEmail = `e2e-captain-${stamp}@example.com`;
  const newAdminEmail = `e2e-newadmin-${stamp}@example.com`;
  const tag = `E2E運営${stamp}`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [captain] = await owner.insert(users).values({ email: captainEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [newAdmin] = await owner.insert(users).values({ email: newAdminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  // 準備: テナント管理者、代表者 1 人のチームと選手 1 人
  const { teamId, memberName } = await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: admin.id });
    const [team] = await tx.insert(teams).values({ associationId: SAWARA_ASSOCIATION_ID, name: `${tag} チーム`, createdBy: captain.id }).returning({ id: teams.id });
    await tx.insert(teamAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, teamId: team.id, userId: captain.id });
    const memberName = `${tag} 花子`;
    const [m] = await tx
      .insert(members)
      .values({ associationId: SAWARA_ASSOCIATION_ID, name: memberName, birthDate: "1995-05-05", sex: "female", nameNormalized: normalizeName(memberName) })
      .returning({ id: members.id });
    await tx.insert(teamMembers).values({ associationId: SAWARA_ASSOCIATION_ID, teamId: team.id, memberId: m.id });
    return { teamId: team.id, memberName };
  });

  try {
    await login(page, request, adminEmail, "/sawara/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("早良区協会の管理", { timeout: 15_000 });
    await page.getByRole("link", { name: "チーム管理" }).click();
    await expect(page).toHaveURL(/\/sawara\/admin\/teams$/, { timeout: 15_000 });
    await page.getByLabel("チーム名で探す").fill(tag);
    await page.getByRole("button", { name: "探す" }).click();
    await expect(page.getByText("1 件")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: new RegExp(`${tag} チーム`) }).click();
    await expect(page).toHaveURL(new RegExp(`/sawara/admin/teams/${teamId}$`), { timeout: 15_000 });
    await expect(page.getByText("代表者（1 人）")).toBeVisible();

    // 代表者の付け替え: 加える → 元の代表者を外す
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByLabel("代表者を加える（アカウントのメールアドレス）").fill(newAdminEmail);
    await page.getByRole("button", { name: "代表者に加える" }).click();
    await expect(page.getByText("代表者に加えました")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("代表者（2 人）")).toBeVisible({ timeout: 15_000 });
    await page.locator("li", { hasText: captainEmail }).getByRole("button", { name: "外す" }).click();
    await expect(page.getByText("代表者（1 人）")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("li", { hasText: newAdminEmail })).toBeVisible();

    // メンバー管理: 探す → 開く → 誤登録の行を消す
    await page.goto("/sawara/admin/members");
    await page.getByLabel("氏名・ふりがなで探す").fill(memberName);
    await page.getByRole("button", { name: "探す" }).click();
    await expect(page.getByText("1 件", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1995年（平成7年）5月5日", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(memberName) }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(memberName, { timeout: 15_000 });
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByRole("button", { name: "誤登録として行を消す" }).click();
    await page.getByRole("button", { name: "行を消す" }).click();
    await expect(page.getByText("どのチームの選手一覧にも載っていません")).toBeVisible({ timeout: 15_000 });
  } finally {
    await owner.delete(sessions).where(inArray(sessions.userId, [admin.id, captain.id, newAdmin.id]));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(teams).where(eq(teams.id, teamId));
      await tx.delete(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), like(members.nameNormalized, `${normalizeName(tag)}%`)));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(users).where(inArray(users.id, [admin.id, captain.id, newAdmin.id]));
    await closeDb(owner);
  }
});
