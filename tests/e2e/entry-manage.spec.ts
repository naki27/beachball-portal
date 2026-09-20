import { expect, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, entries, exportLogs, mailLogs, members, sessions, teams, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "../../src/lib/admin/categories";
import { createTournament } from "../../src/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "../../src/lib/authz";
import { submitEntry } from "../../src/lib/entries/submit-entry";
import { listCategoryPresets } from "../../src/lib/repo/category-presets";
import { addPlayer } from "../../src/lib/teams/roster";
import { registerTeam } from "../../src/lib/teams/teams";
import { test } from "./fixtures";

// 申込の変更・取消・前回コピーと、管理者の申込一覧・CSV（設計書 §5.5(b)(d)(f)・§5.3・B-11〜B-16）
// 375×667（WebKit）と 360×640（Chromium）の両方で流す（§12.1）
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

async function logout(page: Page) {
  await page.goto("/mypage");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/$|\/login/, { timeout: 15_000 });
}

test("申し込んだあと: マイページ → 変更 → 管理者の一覧と CSV → 取消 → 前回コピー", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const name = `E2E変更${stamp}`;
  const teamName = `${name}チーム`;
  const repEmail = `e2e-manage-rep-${stamp}@example.com`;
  const adminEmail = `e2e-manage-admin-${stamp}@example.com`;

  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [rep] = await owner.insert(users).values({ email: repEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: admin.id }));
  const adminActor: Principal & { userId: string } = { ...ANONYMOUS, userId: admin.id, sessionState: "active" };
  const repActor: Principal & { userId: string } = { ...ANONYMOUS, userId: rep.id, sessionState: "active" };

  try {
    const presets = await withTenantOn(app, S, (tx) => listCategoryPresets(tx, S, { onlyActive: true }));
    const chosen = presets.filter((p) => ["m_free", "m_40"].includes(p.code)).map((p) => p.id);
    const tournament = await createTournament(app, adminActor, S, {
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
    await addCategoriesFromPresets(app, adminActor, S, tournament.id, { presetIds: chosen });
    const categories = await getCategoriesForAdmin(app, adminActor, S, tournament.id);
    const freeCategory = categories.categories.find((c) => c.code === "m_free");
    if (!freeCategory) throw new Error("部が作られていない");

    const team = await registerTeam(
      app,
      S,
      rep.id,
      { name: teamName, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false },
      { confirmSameName: true },
    );
    const roster: { memberId: string; name: string; kana: string; birthDate: string; sex: "male" }[] = [];
    for (const p of [
      { name: `${name}アキラ`, kana: "あきら", birthDate: "1975-04-01", sex: "male" as const },
      { name: `${name}イサム`, kana: "いさむ", birthDate: "1978-05-02", sex: "male" as const },
      { name: `${name}ウシオ`, kana: "うしお", birthDate: "1980-06-03", sex: "male" as const },
      { name: `${name}エイジ`, kana: "えいじ", birthDate: "1982-07-04", sex: "male" as const },
      { name: `${name}オサム`, kana: "おさむ", birthDate: "1984-08-05", sex: "male" as const },
    ]) {
      const { memberId } = await addPlayer(app, repActor, S, team.id, p);
      roster.push({ memberId, ...p });
    }

    // 申し込みは B-10 の E2E で確かめているので、ここは保存されたあとの流れを見る
    const entry = await submitEntry(app, repActor, S, tournament.id, {
      teamId: team.id,
      newTeamName: "",
      teamName,
      categoryId: freeCategory.id,
      slots: roster.slice(0, 4).map((p) => ({ kind: "pick", memberId: p.memberId, name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex })),
      note: "駐車場を使います",
      token: crypto.randomUUID(),
    });

    // マイページに「代表者として操作できる申し込み」が出る（§5.3）
    await login(page, request, repEmail, "/mypage");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("マイページ", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "代表者として操作できる申し込み" })).toBeVisible();
    await page.locator(`a[href="/${SAWARA_SLUG}/entries/${entry.entryId}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/entries/${entry.entryId}$`), { timeout: 20_000 });

    // 締切前なので、このページから変更・取消ができる（§5.5(d)）
    await expect(page.getByRole("heading", { name: "変更・取り消し" })).toBeVisible();
    await page.getByRole("link", { name: "申し込みの内容を変える" }).click();
    await expect(page).toHaveURL(/\/edit$/, { timeout: 20_000 });
    await page.locator("[data-hydrated]").first().waitFor();

    // 選手を 1 人入れ替えて、備考を直す
    await page.getByRole("button", { name: "選び直す" }).last().click();
    await page.getByLabel("選手", { exact: true }).last().selectOption(roster[4].memberId);
    await page.getByLabel("運営に伝えること").fill("会場に早めに着きます");
    await page.getByRole("button", { name: "この内容に変更する" }).click();
    await expect(page).toHaveURL(new RegExp(`/entries/${entry.entryId}$`), { timeout: 30_000 });
    await expect(page.getByText(`${name}オサム`, { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("会場に早めに着きます")).toBeVisible();

    // 変更のメールが送信待ちに積まれる（§11）
    const queued = await owner.select({ mailType: mailLogs.mailType }).from(mailLogs).where(eq(mailLogs.toEmail, repEmail));
    expect(queued.some((m) => m.mailType === "entry_updated")).toBe(true);

    // 画面幅で横にはみ出さない（§4.3）
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 管理者の申込一覧と CSV（§5.5(f)）
    await logout(page);
    await login(page, request, adminEmail, `/${SAWARA_SLUG}/admin/tournaments/${tournament.id}/entries`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name}の申し込み`, { timeout: 20_000 });
    await expect(page.getByText(teamName, { exact: false }).first()).toBeVisible();

    // CSV は 1 選手 1 行。生年月日はチェックを入れたときだけ
    const csvUrl = `/api/${SAWARA_SLUG}/admin/tournaments/${tournament.id}/entries/exports`;
    const plain = await page.request.post(csvUrl, { form: {}, headers: { referer: page.url() } });
    expect(plain.ok()).toBe(true);
    const plainText = await plain.text();
    expect(plainText).toContain(teamName);
    expect(plainText).not.toContain("生年月日");
    expect(plainText).not.toContain("1975-04-01");
    const withBirth = await page.request.post(csvUrl, { form: { include_birth_date: "on" }, headers: { referer: page.url() } });
    const withBirthText = await withBirth.text();
    expect(withBirthText).toContain("生年月日");
    expect(withBirthText).toContain("1975-04-01");
    // 出力は記録される（§5.13）
    const logs = await withTenantOn(owner, S, (tx) =>
      tx.select({ id: exportLogs.id }).from(exportLogs).where(eq(exportLogs.scopeId, tournament.id)),
    );
    expect(logs.length).toBe(2);

    // 代表者が取り消すと、参加チーム一覧にも管理画面にも出なくなる（§5.5(d)）
    await logout(page);
    await login(page, request, repEmail, `/${SAWARA_SLUG}/entries/${entry.entryId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("申し込みの内容", { timeout: 20_000 });
    // 画面が動くようになるまで待つ（先に触っても反応しない）
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByRole("button", { name: "この申し込みを取り消す" }).click();
    await expect(page.getByText("取り消すと元に戻せません。もう一度出る場合は申し込み直してください。")).toBeVisible();
    await page.getByRole("button", { name: "申し込みを取り消す" }).click();
    await expect(page.getByText("この申し込みは取り消されています").first()).toBeVisible({ timeout: 30_000 });

    await page.goto(`/${SAWARA_SLUG}/tournaments/${tournament.id}/entries`);
    await expect(page.getByText(teamName, { exact: false })).toHaveCount(0, { timeout: 20_000 });

    // 申し込み直すときは「前回と同じ選手にする」で選手を戻せる（§5.5(b)）
    await page.goto(`/${SAWARA_SLUG}/tournaments/${tournament.id}/entry`);
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByRole("button", { name: "前回と同じ選手にする" }).click();
    await expect(page.getByText("と同じ選手にしました", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`${name}オサム`, { exact: false })).toBeVisible();
    // 同じ code の部が選ばれている
    await expect(page.getByLabel("部", { exact: true })).toHaveValue(freeCategory.id);
  } finally {
    await owner.delete(sessions).where(inArray(sessions.userId, [admin.id, rep.id]));
    await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, [repEmail, adminEmail]));
    await withTenantOn(owner, S, async (tx) => {
      await tx.delete(exportLogs).where(eq(exportLogs.userId, admin.id));
      await tx.delete(entries).where(like(entries.teamName, `${name}%`));
      await tx.delete(tournaments).where(like(tournaments.name, `${name}%`));
      await tx.delete(teams).where(eq(teams.createdBy, rep.id));
      await tx.delete(members).where(like(members.name, `${name}%`));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(users).where(inArray(users.id, [admin.id, rep.id]));
    await closeDb(owner);
    await closeDb(app);
  }
});
