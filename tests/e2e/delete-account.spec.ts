import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { loginCodes, mailLogs, members, sessions, teamAdmins, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";

// アカウントの削除（設計書 §5.19）: 代表者は削除できない → 降りれば削除でき、同じアドレスで作り直せる
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

async function latestCode(request: Req, email: string, since = 0): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email} subject:確認番号`)}`);
    const body = (await res.json()) as { messages?: { Subject: string; Created: string }[] };
    const found = (body.messages ?? []).filter((m) => new Date(m.Created).getTime() >= since);
    const code = found[0]?.Subject.match(/(\d{6})$/);
    if (code) return code[1];
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

test("代表者のアカウントは削除できない。チームがなければ削除でき、同じアドレスで作り直せる", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const email = `e2e-delete-${stamp}@example.com`;
  const tag = `E2E削除${stamp}`;
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const teamId = await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ associationId: SAWARA_ASSOCIATION_ID, name: `${tag} チーム`, createdBy: user.id })
      .returning({ id: teams.id });
    await tx.insert(teamAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, teamId: team.id, userId: user.id });
    return team.id;
  });

  try {
    // 代表者のうちは削除できない（理由と次の手順が出る）
    await login(page, request, email, "/mypage/delete");
    await expect(page).toHaveURL(/\/mypage\/delete$/, { timeout: 15_000 });
    await expect(page.getByRole("status").or(page.getByRole("alert"))).toContainText("代表者を務めているチームがあります");
    await expect(page.getByRole("button", { name: "確認番号を送る" })).toHaveCount(0);

    // チームがなくなれば削除できる（ここではチームを消して代表者でなくする）
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
      tx.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, teamId)),
    );
    await page.reload();
    await expect(page.getByText("削除すると、こうなります")).toBeVisible({ timeout: 15_000 });
    const since = Date.now();
    await page.getByRole("button", { name: "確認番号を送る" }).click();
    await expect(page.getByLabel("確認番号（6 けた）")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email, since));
    await page.getByRole("button", { name: "アカウントを削除する" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // 元のアドレスは残らない。同じアドレスで新しいアカウントを作れる
    const [deleted] = await owner.select().from(users).where(eq(users.id, user.id));
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.email).not.toBe(email);
    await login(page, request, email, "/mypage");
    await expect(page).toHaveURL(/\/mypage$/, { timeout: 15_000 });
    await expect(page.getByText(email)).toBeVisible();
  } finally {
    const ids = (await owner.select({ id: users.id }).from(users).where(eq(users.email, email))).map((u) => u.id);
    const all = [...new Set([user.id, ...ids])];
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(teams).where(inArray(teams.createdBy, all));
      await tx.delete(members).where(inArray(members.userId, all));
    });
    await owner.delete(sessions).where(inArray(sessions.userId, all));
    await owner.delete(loginCodes).where(inArray(loginCodes.userId, all));
    await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%${stamp}@example.com`));
    await owner.delete(users).where(inArray(users.id, all));
    await closeDb(owner);
  }
});
