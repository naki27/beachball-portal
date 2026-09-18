import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { eq, inArray } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associations, sessions, teamAdmins, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";

// チームの作成と代表者（設計書 §5.11「チームの作り方」）: チーム名だけで登録 → 代表者としてチームのページ → マイページに出る
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

test("チーム名だけで登録でき、マイページに出る。同じ名前は警告。別の協会のチームは 404", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const email = `e2e-team-${stamp}@example.com`;
  const teamName = `E2E チーム ${stamp}`;
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [other] = await owner
    .insert(associations)
    .values({ name: `E2E よその協会 ${stamp}`, slug: `e2e-team-${stamp}` })
    .returning({ id: associations.id });
  const [otherTeam] = await withTenantOn(owner, other.id, (tx) =>
    tx.insert(teams).values({ associationId: other.id, name: "よその協会のチーム" }).returning({ id: teams.id }),
  );

  try {
    // 未ログインは 403 → ログインすると登録の画面に戻る
    await page.goto("/sawara/teams/new");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("このページを見るにはログインが必要です");
    await page.getByRole("link", { name: "ログインする" }).click();
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByRole("button", { name: "確認番号を送る" }).click();
    await expect(page).toHaveURL(/\/login\/code/, { timeout: 15_000 });
    await page.getByLabel("確認番号（6 けた）").fill(await latestCode(request, email));
    await expect(page).toHaveURL(/\/sawara\/teams\/new$/, { timeout: 15_000 });

    // チーム名だけで登録 → チームのページ（登録した人が代表者なので連絡先と「チーム情報を変える」が出る）
    await page.locator("form[data-hydrated]").waitFor();
    await expect(page.getByLabel("協会員の登録をするチーム")).not.toBeChecked();
    await page.getByLabel("チーム名", { exact: true }).fill(teamName);
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page.getByText("チームを登録しました。あなたがこのチームの代表者です")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(teamName);
    await expect(page.getByRole("link", { name: "チーム情報を変える" })).toBeVisible();

    // マイページの早良区協会の枠に出る
    await page.goto("/mypage");
    const sawara = page.getByRole("region", { name: "早良区協会" });
    await expect(sawara.getByRole("link", { name: teamName })).toBeVisible({ timeout: 15_000 });

    // 同じ名前で登録しようとすると警告（自分のチームへのリンク）
    await page.goto("/sawara/teams/new");
    await page.locator("form[data-hydrated]").waitFor();
    await page.getByLabel("チーム名", { exact: true }).fill(teamName);
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page.getByText("同じ名前のチームが1チームあります")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: teamName })).toBeVisible();

    // 別の協会のチーム ID を早良区協会の下で開くと 404
    await page.goto(`/sawara/teams/${otherTeam.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ページが見つかりません");
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(teamAdmins).where(eq(teamAdmins.userId, user.id));
      await tx.delete(teams).where(eq(teams.createdBy, user.id));
    });
    await withTenantOn(owner, other.id, (tx) => tx.delete(teams).where(inArray(teams.id, [otherTeam.id])));
    await owner.delete(associations).where(eq(associations.id, other.id));
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
  }
});
