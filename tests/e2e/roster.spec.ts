import { expect, type Page, test } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { members, sessions, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { normalizeName } from "../../src/lib/normalize";

// 選手一覧（設計書 §5.11）: 追加 → 外す → 元に戻す → 別のチームに同じ人を追加しても人物は増えない
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

async function createTeam(page: Page, name: string): Promise<string> {
  await page.goto("/sawara/teams/new");
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("チーム名", { exact: true }).fill(name);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page).toHaveURL(/\/sawara\/teams\/[0-9a-f-]+\?created=1$/, { timeout: 15_000 });
  return page.url().match(/\/teams\/([0-9a-f-]+)/)![1];
}

async function addPlayer(
  page: Page,
  teamId: string,
  name: string,
  era: string,
  year: string,
  month: string,
  day: string,
  sex: string,
  // 今日時点で 15 歳未満・80 歳以上のときは「◯歳で合っていますか？」に答える（§4.3）
  confirmAge = false,
) {
  await page.goto(`/sawara/teams/${teamId}/members/new`);
  await page.locator("form[data-hydrated]").waitFor();
  await expect(page.getByText("ご本人（未成年の方は保護者）の同意を得て入力してください")).toBeVisible();
  await page.getByLabel("氏名").fill(name);
  await page.getByRole("radiogroup", { name: "生年月日の元号" }).getByText(era, { exact: true }).click();
  await page.getByLabel("年", { exact: true }).fill(year);
  await page.getByLabel("月", { exact: true }).fill(month);
  await page.getByLabel("日", { exact: true }).fill(day);
  await page.getByRole("radiogroup", { name: "性別" }).getByText(sex, { exact: true }).click();
  if (confirmAge) {
    await expect(page.getByText(/^\d+歳で合っていますか？$/)).toBeVisible();
    await page.getByRole("button", { name: "はい、合っています" }).click();
  }
  await page.getByRole("button", { name: "選手一覧に追加する" }).click();
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/members\\?added=1$`), { timeout: 15_000 });
}

test("選手を 4 人追加 → 1 人外す → 元に戻す。別のチームに同じ人を追加しても人物は増えない", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const email = `e2e-roster-${stamp}@example.com`;
  const tag = `E2E名簿${stamp}`;
  const [user] = await owner.insert(users).values({ email, emailVerifiedAt: new Date() }).returning({ id: users.id });

  try {
    await login(page, request, email, "/sawara");
    await expect(page).toHaveURL(/\/sawara$/, { timeout: 15_000 });
    const teamA = await createTeam(page, `${tag} A`);

    // 4 人追加（昭和・平成・令和・西暦をひととおり）
    await addPlayer(page, teamA, `${tag} 一郎`, "昭和", "40", "5", "3", "男性");
    await addPlayer(page, teamA, `${tag} 二郎`, "平成", "5", "4", "1", "男性");
    await addPlayer(page, teamA, `${tag} 三子`, "令和", "3", "1", "1", "女性", true);
    await addPlayer(page, teamA, `${tag} 四子`, "西暦", "1999", "12", "31", "女性");
    // 代表者には生年月日・年齢・性別が見える（1 人 = 1 カード）
    await expect(page.getByText("1965年（昭和40年）5月3日", { exact: false })).toBeVisible();
    await expect(page.locator("li", { hasText: `${tag} 三子` })).toContainText("女性");
    await expect(page.getByRole("button", { name: "選手一覧から外す" })).toHaveCount(4);

    // 1 人外す → 「外しました［元に戻す］」→ 元に戻す
    await page.locator("[data-hydrated]").first().waitFor();
    await page.locator("li", { hasText: `${tag} 二郎` }).getByRole("button", { name: "選手一覧から外す" }).click();
    await expect(page.getByText(`${tag} 二郎さんを外しました`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "選手一覧から外す" })).toHaveCount(3);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByRole("button", { name: "選手一覧から外す" })).toHaveCount(4, { timeout: 15_000 });
    await expect(page.getByText(`${tag} 二郎さんを外しました`)).toHaveCount(0);

    // 別のチームに同じ氏名・生年月日・性別の人を追加 → members は増えない
    const teamB = await createTeam(page, `${tag} B`);
    await addPlayer(page, teamB, `${tag} 一郎`, "昭和", "40", "5", "3", "男性");
    await expect(page.locator("li", { hasText: `${tag} 一郎` })).toBeVisible();
    const ichiro = await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
      tx.select({ id: members.id }).from(members).where(eq(members.nameNormalized, normalizeName(`${tag} 一郎`))),
    );
    expect(ichiro).toHaveLength(1);
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, user.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(teams).where(eq(teams.createdBy, user.id));
      await tx.delete(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    });
    await owner.delete(users).where(eq(users.id, user.id));
    await closeDb(owner);
  }
});
