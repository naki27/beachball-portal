import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { eq, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { loginCodes, mailLogs, sessions, users } from "../../src/db/schema";
import { processMailQueue } from "../../src/lib/mail/queue";
import { createMailSender } from "../../src/lib/mail/sender";

// メールアドレスの変更（設計書 §5.19）: 変更 → Mailpit に新旧 2 通 → 新しいアドレスでログインできる
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

async function mailpitSearch(request: Req, query: string): Promise<{ Subject: string; ID: string }[]> {
  const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  return ((await res.json()) as { messages?: { Subject: string; ID: string }[] }).messages ?? [];
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

test("メールアドレスを変えると、新しいアドレスに番号・古いアドレスに知らせが届き、新しいアドレスでログインできる", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const oldEmail = `e2e-mail-old-${stamp}@example.com`;
  const newEmail = `e2e-mail-new-${stamp}@example.com`;
  const [user] = await owner.insert(users).values({ email: oldEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });

  try {
    await login(page, request, oldEmail, "/mypage");
    await expect(page).toHaveURL(/\/mypage$/, { timeout: 15_000 });
    await page.getByRole("link", { name: "メールアドレスを変更する" }).click();
    await expect(page).toHaveURL(/\/mypage\/email$/, { timeout: 15_000 });
    await expect(page.getByText(oldEmail)).toBeVisible();

    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("新しいメールアドレス").fill(newEmail);
    await page.getByRole("button", { name: "確認番号を送る" }).click();
    await expect(page.getByLabel("確認番号（6 けた）")).toBeVisible({ timeout: 15_000 });

    // 番号は新しいアドレスにだけ届く
    const code = await latestCode(request, newEmail);
    await page.getByLabel("確認番号（6 けた）").fill(code);
    await page.getByRole("button", { name: "メールアドレスを変更する" }).click();
    await expect(page.getByRole("status")).toContainText("メールアドレスを変更しました", { timeout: 15_000 });

    // 古いアドレスには知らせ（送信ジョブが送る）
    await processMailQueue(job, createMailSender());
    const notice = await mailpitSearch(request, `to:${oldEmail} subject:"メールアドレスを変更しました"`);
    expect(notice.length).toBe(1);

    // マイページのアドレスが変わり、新しいアドレスでログインできる
    await page.goto("/mypage");
    await expect(page.getByText(newEmail)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await login(page, request, newEmail, "/mypage");
    await expect(page).toHaveURL(/\/mypage$/, { timeout: 15_000 });
    await expect(page.getByText(newEmail)).toBeVisible();
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await owner.delete(loginCodes).where(eq(loginCodes.userId, user.id));
    await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%-${stamp}@example.com`));
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
    await closeDb(job);
  }
});
