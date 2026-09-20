import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { and, eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, contactMessages, mailLogs, sessions, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { processMailQueue } from "../../src/lib/mail/queue";
import { createMailSender } from "../../src/lib/mail/sender";

// 問い合わせフォーム（設計書 §5.10）: ログインせずに送る → Mailpit に控えと転送の 2 通 → 管理画面の一覧に出る
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

async function mailpitSearch(request: Req, query: string): Promise<{ Subject: string; ID: string }[]> {
  const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  return ((await res.json()) as { messages?: { Subject: string; ID: string }[] }).messages ?? [];
}

async function mailText(request: Req, id: string): Promise<string> {
  return ((await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string }).Text;
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

test("ログインせずに協会へ送ると、控えと転送が届き、管理画面の一覧に出る", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const senderEmail = `e2e-contact-${stamp}@example.com`;
  const adminEmail = `e2e-contact-admin-${stamp}@example.com`;
  const body = `E2E の問い合わせ ${stamp}`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
    tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: admin.id }),
  );

  try {
    // フッタの「お問い合わせ」は、協会の画面ではその協会宛てへ
    await page.goto("/sawara/");
    await page.getByRole("navigation", { name: "サイトの案内" }).getByRole("link", { name: "お問い合わせ" }).click();
    await expect(page).toHaveURL(/\/sawara\/contact$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "早良区協会へのお問い合わせ" })).toBeVisible();

    await page.getByLabel("お名前").fill("問い合わせ 太郎");
    await page.getByLabel("返信先のメールアドレス").fill(senderEmail);
    await page.getByLabel("お問い合わせの種類").selectOption({ label: "ログインできない・メールが届かない" });
    await page.getByLabel("お問い合わせの内容").fill(body);
    await page.getByRole("button", { name: "送信する" }).click();
    await expect(page.getByRole("status")).toContainText("お問い合わせを受け付けました", { timeout: 15_000 });

    // 送信ジョブ → Mailpit に控え（送信者）と転送（協会の連絡先。未設定なので CONTACT_TO）の 2 通
    await processMailQueue(job, createMailSender());
    const receipt = await mailpitSearch(request, `to:${senderEmail}`);
    expect(receipt.length).toBe(1);
    expect(receipt[0].Subject).toBe("【早良区協会】お問い合わせを受け付けました");
    expect(await mailText(request, receipt[0].ID)).toContain(body);
    const forwarded = await mailpitSearch(request, `subject:"お問い合わせが届きました" "${stamp}"`);
    expect(forwarded.length).toBe(1);
    const forwardedText = await mailText(request, forwarded[0].ID);
    expect(forwardedText).toContain(`返信先: ${senderEmail}`);
    expect(forwardedText).toContain(body);

    // テナント管理者の管理画面の一覧に「未対応」で出る → 対応済みにする
    await login(page, request, adminEmail, "/sawara/admin/contacts");
    await expect(page).toHaveURL(/\/sawara\/admin\/contacts$/, { timeout: 15_000 });
    await page.locator("[data-hydrated]").first().waitFor();
    const card = page.locator("article", { hasText: body });
    await expect(card).toContainText("ログインできない・メールが届かない");
    await expect(card).toContainText("未対応");
    await card.getByRole("button", { name: "対応済みにする" }).click();
    await expect(page.locator("article", { hasText: body })).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("link", { name: "すべて" }).click();
    await expect(page.locator("article", { hasText: body })).toContainText("対応済み", { timeout: 15_000 });
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, admin.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
      tx.delete(contactMessages).where(
        and(eq(contactMessages.associationId, SAWARA_ASSOCIATION_ID), like(contactMessages.body, `%${stamp}%`)),
      ),
    );
    await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, [senderEmail, adminEmail, "contact@localhost"]));
    await owner.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    await owner.delete(users).where(eq(users.id, admin.id));
    await closeDb(owner);
    await closeDb(job);
  }
});

test("/contact では宛先を選んでから送る", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: "お問い合わせ" })).toBeVisible();
  // 宛先を選ぶまで、入力欄は出さない
  await expect(page.getByLabel("お問い合わせの種類")).toHaveCount(0);
  await page.getByLabel("このサイトの運営者（ログインなど）").check();
  // サイトの運営者宛てに、申し込みの種別は出さない
  await expect(page.getByLabel("お問い合わせの種類").getByRole("option")).toHaveText([
    "選んでください",
    "ログインできない・メールが届かない",
    "チームの解散・アカウントの削除",
    "その他",
  ]);
});
