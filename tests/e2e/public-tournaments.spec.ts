import { expect } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, entries, entryPlayers, teams, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "../../src/db/seed";
import { todayInTokyo } from "../../src/lib/date";
import { withTenantOn } from "../../src/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "../../src/lib/admin/categories";
import { createTournament } from "../../src/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "../../src/lib/authz";
import { normalizeName } from "../../src/lib/normalize";
import { listCategoryPresets } from "../../src/lib/repo/category-presets";
import { registerTeam } from "../../src/lib/teams/teams";
import { test } from "./fixtures";

// 公開ページ（設計書 §5.6・B-06）: ログアウトしたまま大会を見る。選手の情報はどこにも出ない
const S = SAWARA_ASSOCIATION_ID;

// 今日からの相対で日付を作る（いつ流しても「受付中」のまま）
// 画面の「あと◯日」は**日本時間の今日**から数える（§7.0）。UTC の今日で作ると、日本の夜（UTC 15:00 以降）に 1 日ずれる
function dayFrom(days: number): string {
  const today = todayInTokyo();
  return new Date(Date.UTC(today.year, today.month - 1, today.day + days)).toISOString().slice(0, 10);
}

test("未ログインで大会を見る（参加チーム一覧に選手の情報が出ない）", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const name = `E2E公開${stamp}`;
  const teamName = `${name}チーム`;

  const [admin] = await owner.insert(users).values({ email: `e2e-pub-admin-${stamp}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [rep] = await owner.insert(users).values({ email: `e2e-pub-rep-${stamp}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: admin.id }));
  const actor: Principal & { userId: string } = { ...ANONYMOUS, userId: admin.id, sessionState: "active" };

  try {
    const presets = await withTenantOn(app, S, (tx) => listCategoryPresets(tx, S, { onlyActive: true }));
    const chosen = presets.filter((p) => ["m_40", "x_160"].includes(p.code)).map((p) => p.id);

    const base = {
      eventDate: dayFrom(60),
      ageReferenceDate: dayFrom(60),
      venue: "早良体育館",
      description: "参加費は 1 チーム 3,000 円です。",
      entryStartDate: dayFrom(-5),
      entryEndDate: dayFrom(10),
      teamSizeMin: "4",
      teamSizeMax: "8",
      maxEntries: "",
    };
    const open = await createTournament(app, actor, S, { ...base, name: `${name} 受付中`, status: "open" });
    const draft = await createTournament(app, actor, S, { ...base, name: `${name} 準備中`, status: "draft" });
    await addCategoriesFromPresets(app, actor, S, open.id, { presetIds: chosen, mixedNotation: "kanji" });

    // 申込 1 件（選手つき）。公開の応答に混ざらないことを確かめるため
    const team = await registerTeam(
      app,
      S,
      rep.id,
      { name: teamName, kana: null, contactEmail: "rep@example.com", contactPhone: "090-0000-0000", membershipRenewalTarget: false },
      { confirmSameName: true },
    );
    const view = await getCategoriesForAdmin(app, actor, S, open.id);
    const categoryId = view.categories[0].id;
    await withTenantOn(owner, S, async (tx) => {
      const [entry] = await tx
        .insert(entries)
        .values({ associationId: S, tournamentId: open.id, categoryId, teamId: team.id, createdBy: rep.id, teamName })
        .returning({ id: entries.id });
      await tx.insert(entryPlayers).values({
        associationId: S,
        entryId: entry.id,
        position: 1,
        name: "公開太郎",
        birthDate: "1980-05-01",
        sex: "male",
        ageAtEvent: 46,
        nameNormalized: normalizeName("公開太郎"),
      });
    });

    // 大会一覧（ログアウトのまま）
    await page.goto(`/${SAWARA_SLUG}/tournaments`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("大会一覧", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: new RegExp(`${name} 準備中`) })).toHaveCount(0);
    await page.getByRole("link", { name: new RegExp(`${name} 受付中`) }).click();

    // 大会詳細: 部の条件の文章と「あと◯日」、未ログインは「ログインして申し込む」
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name} 受付中`, { timeout: 15_000 });
    await expect(page.getByText(/まで　あと10日/)).toBeVisible();
    await expect(page.getByText("出場する全員が40歳以上です", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "ログインして申し込む" })).toBeVisible();
    // 画面幅 375px で横にはみ出さない（§4.3）
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 参加チーム一覧: チーム名は出るが、選手の氏名は出ない
    await page.getByRole("link", { name: /参加チーム一覧/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("参加チーム一覧", { timeout: 15_000 });
    await expect(page.getByText(teamName)).toBeVisible();
    await expect(page.getByText("公開太郎")).toHaveCount(0);

    // API も同じ（フロントで隠すだけにしない・§5.6 受け入れ条件）
    const response = await request.get(`/api/${SAWARA_SLUG}/tournaments/${open.id}/entries`);
    expect(response.status()).toBe(200);
    const json = JSON.stringify(await response.json());
    expect(json).toContain(teamName);
    for (const secret of ["公開太郎", "1980-05-01", "rep@example.com", "090-0000-0000"]) {
      expect(json).not.toContain(secret);
    }

    // 準備中の大会は URL を直に打っても 404
    const draftResponse = await request.get(`/api/${SAWARA_SLUG}/tournaments/${draft.id}`);
    expect(draftResponse.status()).toBe(404);
    await page.goto(`/${SAWARA_SLUG}/tournaments/${draft.id}`);
    await expect(page.getByText("ページが見つかりません")).toBeVisible({ timeout: 15_000 });
  } finally {
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
