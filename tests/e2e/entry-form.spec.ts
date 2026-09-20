import { expect, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, sessions, teams, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { addCategoriesFromPresets } from "../../src/lib/admin/categories";
import { createTournament } from "../../src/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "../../src/lib/authz";
import { listCategoryPresets } from "../../src/lib/repo/category-presets";
import { registerTeam } from "../../src/lib/teams/teams";
import { test } from "./fixtures";

// 大会申込の入力ページ（設計書 §5.5・B-07）: 代表者がチームと部を選ぶ。再読み込みしても入力が残る
const S = SAWARA_ASSOCIATION_ID;
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

function dayFrom(days: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
}

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

test("代表者が申込ページでチームと部を選ぶ（再読み込みしても残る）", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const name = `E2E申込${stamp}`;
  const teamName = `${name}チーム`;
  const repEmail = `e2e-entry-rep-${stamp}@example.com`;

  const [admin] = await owner.insert(users).values({ email: `e2e-entry-admin-${stamp}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [rep] = await owner.insert(users).values({ email: repEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: admin.id }));
  const actor: Principal & { userId: string } = { ...ANONYMOUS, userId: admin.id, sessionState: "active" };

  try {
    const presets = await withTenantOn(app, S, (tx) => listCategoryPresets(tx, S, { onlyActive: true }));
    const chosen = presets.filter((p) => ["m_40", "w_free"].includes(p.code)).map((p) => p.id);
    const tournament = await createTournament(app, actor, S, {
      name,
      eventDate: dayFrom(60),
      ageReferenceDate: dayFrom(60),
      venue: "早良体育館",
      description: "",
      entryStartDate: dayFrom(-5),
      entryEndDate: dayFrom(10),
      teamSizeMin: "4",
      teamSizeMax: "8",
      maxEntries: "",
      status: "open",
    });
    await addCategoriesFromPresets(app, actor, S, tournament.id, { presetIds: chosen, mixedNotation: "kanji" });
    await registerTeam(
      app,
      S,
      rep.id,
      { name: teamName, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false },
      { confirmSameName: true },
    );

    // 大会ページの「申し込む」から入る
    const entryUrl = `/${SAWARA_SLUG}/tournaments/${tournament.id}/entry`;
    await login(page, request, repEmail, entryUrl);
    await expect(page).toHaveURL(new RegExp(`${tournament.id}/entry$`), { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name}に申し込む`);

    // 画面が動くようになるまで待つ（先に触ると、あとから React が初期値に戻す）
    await page.locator("[data-hydrated]").first().waitFor();

    // 「入力 → 確認 → 完了」の現在位置
    await expect(page.getByRole("navigation", { name: "申し込みの進み具合" }).getByText("入力")).toHaveAttribute("aria-current", "step");

    // 代表を務めるチームが 1 つなので、そのまま表示され、公開されるチーム名に初期値が入る
    await expect(page.getByLabel("チーム名（公開されます）")).toHaveValue(teamName);

    // 部を選ぶと条件の文章が出る
    await page.getByLabel("部", { exact: true }).selectOption({ label: "男子40歳以上の部" });
    await expect(page.getByText("出場する全員が40歳以上です", { exact: false })).toBeVisible();

    // 備考とチーム名を直して、再読み込みしても残る（一時保存・§4.3）
    await page.getByLabel("チーム名（公開されます）").fill(`${teamName}B`);
    await page.getByLabel("運営に伝えること").fill("駐車場を使います");
    await expect(page.getByText("入力した内容をこの端末に保存しました。")).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByLabel("チーム名（公開されます）")).toHaveValue(`${teamName}B`, { timeout: 15_000 });
    await expect(page.getByLabel("運営に伝えること")).toHaveValue("駐車場を使います");
    await expect(page.getByLabel("部", { exact: true })).not.toHaveValue("");

    // 「確認へ」は入力を検査するところまで（選手枠は次の作業）
    await page.getByRole("button", { name: "確認へ" }).click();
    await expect(page.getByText("ここまでの入力は保存しました", { exact: false })).toBeVisible();

    // 画面幅 375px で横にはみ出さない（§4.3）
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await owner.delete(sessions).where(inArray(sessions.userId, [admin.id, rep.id]));
    await withTenantOn(owner, S, async (tx) => {
      await tx.delete(tournaments).where(like(tournaments.name, `${name}%`));
      await tx.delete(teams).where(eq(teams.createdBy, rep.id));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(users).where(inArray(users.id, [admin.id, rep.id]));
    await closeDb(owner);
    await closeDb(app);
  }
});
