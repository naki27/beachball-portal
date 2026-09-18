import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { adminAccessLogs, associationAdminInvitations, associationAdmins, mailLogs, platformAdmins, sessions, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { processMailQueue } from "../../src/lib/mail/queue";
import { createMailSender } from "../../src/lib/mail/sender";

// テナント管理者の招待（設計書 §5.14）: 運営管理者が招待 → Mailpit → 本人がログイン → /invitations で参加 → /sawara/admin が開ける
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

async function loginAs(page: Parameters<Parameters<typeof test>[2]>[0]["page"], request: Req, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "確認番号を送る" }).click();
  await expect(page).toHaveURL(/\/login\/code/, { timeout: 15_000 });
  await page.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email));
}

test("運営管理者が招待し、本人が参加すると協会の管理者になる", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const platformEmail = `e2e-inviter-${stamp}@example.com`;
  const inviteeEmail = `e2e-invitee-${stamp}@example.com`;
  const [inviter] = await owner.insert(users).values({ email: platformEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await owner.insert(platformAdmins).values({ userId: inviter.id, note: "e2e" });

  try {
    // 運営管理者: 早良区協会のページから招待
    await loginAs(page, request, platformEmail, `/platform/associations/${SAWARA_ASSOCIATION_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("早良区協会", { timeout: 15_000 });
    await page.locator("[data-hydrated]").first().waitFor();
    // 「協会の連絡先メールアドレス」の欄もあるので完全一致で
    await page.getByLabel("メールアドレス", { exact: true }).fill(inviteeEmail);
    await page.getByRole("button", { name: "招待する" }).click();
    await expect(page.getByText(`${inviteeEmail} に招待のメールを送ります`)).toBeVisible({ timeout: 15_000 });
    // 別のブラウザのテストが同時に別のアドレスを招待しているので、自分の行に絞る
    await expect(page.locator("li", { hasText: inviteeEmail }).getByText(/返事待ち・\d+月\d+日/)).toBeVisible({ timeout: 15_000 });

    // 送信ジョブを流す（本番は数分おきのジョブ）→ Mailpit に招待のメール
    await processMailQueue(job, createMailSender());
    const invitationMails = await mailpitSearch(request, `to:${inviteeEmail} subject:招待`);
    expect(invitationMails.length).toBe(1);
    expect(invitationMails[0].Subject).toBe("【早良区協会】協会の管理者への招待");
    const bodyRes = await request.get(`${MAILPIT}/api/v1/message/${invitationMails[0].ID}`);
    const body = (await bodyRes.json()) as { Text: string };
    expect(body.Text).toContain("/sawara/");
    expect(body.Text).toContain(inviteeEmail);
    expect(body.Text).toMatch(/期限: \d+月\d+日（[日月火水木金土]）まで/);
    expect(body.Text).not.toMatch(/\/login/);

    // 運営管理者はログアウト → 本人がログイン → /invitations
    await page.locator("header summary", { hasText: "メニュー" }).click();
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await loginAs(page, request, inviteeEmail, "/invitations");
    await expect(page).toHaveURL(/\/invitations$/, { timeout: 15_000 });
    await expect(page.getByText("早良区協会の管理者として招待されています")).toBeVisible({ timeout: 15_000 });
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByRole("button", { name: "参加する" }).click();
    await expect(page).toHaveURL(/\/sawara\/admin$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("早良区協会の管理", { timeout: 15_000 });
  } finally {
    const rows = await owner.select({ id: users.id }).from(users).where(inArray(users.email, [platformEmail, inviteeEmail]));
    const ids = rows.map((r) => r.id);
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(associationAdmins).where(inArray(associationAdmins.userId, ids));
      await tx.delete(associationAdminInvitations).where(eq(associationAdminInvitations.email, inviteeEmail));
    });
    await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, [platformEmail, inviteeEmail]));
    await owner.delete(adminAccessLogs).where(inArray(adminAccessLogs.userId, ids));
    await owner.delete(sessions).where(inArray(sessions.userId, ids));
    await owner.delete(platformAdmins).where(eq(platformAdmins.userId, inviter.id));
    await owner.delete(users).where(inArray(users.id, ids));
    await closeDb(owner);
    await closeDb(job);
  }
});
