import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, sessions, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";

// テナント管理者の同時ログインの制限（設計書 §9.2）。2 つのブラウザ（別のコンテキスト）で確かめる
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";

async function latestCode(request: Parameters<Parameters<typeof test>[2]>[0]["request"], email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: { Subject: string }[] };
    const m = body.messages?.[0]?.Subject.match(/(\d{6})$/);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("確認番号のメールが届かない");
}

test("テナント管理者は同時に 1 つまで: 別の端末は断られ、ログアウトすると入れる", async ({ browser, request }, testInfo) => {
  test.setTimeout(120_000); // 2 台分のログインの流れ（dev サーバーでは 1 台 20 秒ほどかかる）
  loadEnv();
  const email = `e2e-admin-${testInfo.workerIndex}-${Date.now()}@example.com`;
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: user.id });
  });

  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  try {
    const pageA = await deviceA.newPage();
    await pageA.goto("/login?next=%2Fsawara%2Fadmin");
    await pageA.locator("form[data-hydrated]").waitFor();
    await pageA.getByLabel("メールアドレス").fill(email);
    await pageA.getByRole("button", { name: "確認番号を送る" }).click();
    await expect(pageA).toHaveURL(/\/login\/code/, { timeout: 15_000 });
    await pageA.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email));
    await expect(pageA).toHaveURL(/\/sawara\/admin$/, { timeout: 15_000 });
    // 管理者なので管理画面が開く
    await expect(pageA.getByRole("heading", { level: 1 })).toHaveText("早良区協会の管理", { timeout: 15_000 });

    // 端末 B: 番号は合っていても 409
    const pageB = await deviceB.newPage();
    await pageB.goto("/login");
    await pageB.locator("form[data-hydrated]").waitFor();
    await pageB.getByLabel("メールアドレス").fill(email);
    await pageB.getByRole("button", { name: "確認番号を送る" }).click();
    await expect(pageB).toHaveURL(/\/login\/code/, { timeout: 15_000 });
    const codeB = await latestCode(request, email);
    await pageB.getByLabel("確認番号（6 けた）").fill(codeB);
    await expect(
      pageB.getByText("別の端末（またはアプリ）でログインしています。そちらでログアウトしてから、もう一度お試しください"),
    ).toBeVisible({ timeout: 15_000 });

    // 端末 A はそのまま使える
    await pageA.reload();
    await expect(pageA.getByRole("heading", { level: 1 })).toHaveText("早良区協会の管理", { timeout: 15_000 });

    // 端末 A でログアウト → 端末 B は同じ番号で入れる
    await pageA.getByRole("button", { name: "ログアウト" }).click();
    await expect(pageA).toHaveURL(/\/$/, { timeout: 15_000 });
    await pageB.getByRole("button", { name: "ログイン" }).click();
    await expect(pageB).toHaveURL(/\/sawara$/, { timeout: 15_000 });
    await expect(pageB.getByRole("button", { name: "ログアウト" })).toBeVisible({ timeout: 15_000 });
  } finally {
    await deviceA.close();
    await deviceB.close();
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, user.id));
    });
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
  }
});
