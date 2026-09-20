import { expect, type Page } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, entries, mailLogs, members, sessions, teams, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { addCategoriesFromPresets } from "../../src/lib/admin/categories";
import { createTournament } from "../../src/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "../../src/lib/authz";
import { listCategoryPresets } from "../../src/lib/repo/category-presets";
import { addPlayer } from "../../src/lib/teams/roster";
import { registerTeam } from "../../src/lib/teams/teams";
import { test } from "./fixtures";

// 大会申込（設計書 §5.5・§5.7・B-07 / B-09 / B-10）: 入力 → 確認 → 完了。再読み込みしても入力が残り、再送しても 1 件
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

test("代表者が申し込む（入力 → 確認 → 完了。再読み込みしても残る・再送しても 1 件）", async ({ page, request }, testInfo) => {
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
    const chosen = presets.filter((p) => ["m_40", "w_free", "x_free"].includes(p.code)).map((p) => p.id);
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
    const team = await registerTeam(
      app,
      S,
      rep.id,
      { name: teamName, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false },
      { confirmSameName: true },
    );
    // 申し込むチームの選手一覧（プルダウンの候補）
    const repActor: Principal & { userId: string } = { ...ANONYMOUS, userId: rep.id, sessionState: "active" };
    const ids: string[] = [];
    for (const p of [
      { name: `${name}アキラ`, kana: "あきら", birthDate: "1975-04-01", sex: "male" as const },
      { name: `${name}イサム`, kana: "いさむ", birthDate: "1978-05-02", sex: "male" as const },
      { name: `${name}ウメコ`, kana: "うめこ", birthDate: "1980-06-03", sex: "female" as const },
    ]) {
      ids.push((await addPlayer(app, repActor, S, team.id, p)).memberId);
    }
    // 代表を務めるもう 1 つのチーム（サジェストにだけ出る人）
    const other = await registerTeam(
      app,
      S,
      rep.id,
      { name: `${teamName}別`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false },
      { confirmSameName: true },
    );
    const etsuko = (await addPlayer(app, repActor, S, other.id, { name: `${name}エツコ`, kana: "えつこ", birthDate: "1982-07-04", sex: "female" })).memberId;

    // 大会ページの「申し込む」から入る
    const entryUrl = `/${SAWARA_SLUG}/tournaments/${tournament.id}/entry`;
    await login(page, request, repEmail, entryUrl);
    await expect(page).toHaveURL(new RegExp(`${tournament.id}/entry$`), { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${name}に申し込む`);

    // 画面が動くようになるまで待つ（先に触ると、あとから React が初期値に戻す）
    await page.locator("[data-hydrated]").first().waitFor();

    // 「入力 → 確認 → 完了」の現在位置
    await expect(page.getByRole("navigation", { name: "申し込みの進み具合" }).getByText("入力")).toHaveAttribute("aria-current", "step");

    // 代表を務めるチームが複数なのでプルダウンが出る。公開されるチーム名には選んだチームの名前が入る
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

    // 選手がそろっていなければ「確認へ」で止まる（人数の下限・§5.4）
    await page.getByRole("button", { name: "確認へ" }).click();
    await expect(page.getByText("4人以上で申し込みます", { exact: false })).toBeVisible();

    // 混合の部に変え、申し込むチームの選手一覧から 3 人を選ぶ（選ぶたびに枠の数が減る）
    await page.getByLabel("部", { exact: true }).selectOption({ label: "混合フリーの部" });
    await expect(page.getByTestId("entry-sex-counts")).toContainText("男性0人・女性0人");
    const slotSelect = page.getByLabel("選手", { exact: true });
    await slotSelect.first().selectOption(ids[0]);
    await expect(page.getByTestId("entry-sex-counts")).toContainText("男性1人・女性0人");
    await slotSelect.first().selectOption(ids[1]);
    await slotSelect.first().selectOption(ids[2]);
    await expect(page.getByTestId("entry-sex-counts")).toContainText("男性2人・女性1人");
    // 選んだ人は、ほかの枠の候補から消える（二重選択の防止・§5.5）
    await expect(slotSelect.first().getByRole("option", { name: `${name}アキラ`, exact: false })).toHaveCount(0);

    // 4 人目は、代表を務めるほかのチームの選手をサジェストで探して選ぶ（§8.4）
    await page.getByLabel("名前で探す（任意）").first().fill("えつこ");
    await expect(slotSelect.first().getByRole("option", { name: `${name}エツコ`, exact: false })).toHaveCount(1, { timeout: 15_000 });
    await slotSelect.first().selectOption(etsuko);
    await expect(page.getByTestId("entry-sex-counts")).toContainText("男性2人・女性2人");

    // 5 人目は手入力（一覧にいない人）。同意の文言が出る
    await page.getByRole("button", { name: "選手を追加" }).click();
    await page.getByLabel("選手", { exact: true }).last().selectOption("__manual__");
    await expect(page.getByText("ご本人（未成年の方は保護者）の同意を得て入力してください。")).toBeVisible();
    await page.getByLabel("氏名", { exact: true }).fill(`${name}オサム`);
    await page.getByRole("radiogroup", { name: "生年月日の元号" }).getByText("西暦", { exact: true }).click();
    await page.getByLabel("年", { exact: true }).fill("1985");
    await page.getByLabel("月", { exact: true }).fill("8");
    await page.getByLabel("日", { exact: true }).fill("9");
    await page.getByRole("radio", { name: "男性" }).check();
    await expect(page.getByTestId("entry-sex-counts")).toContainText("男性3人・女性2人");

    // これで人数がそろい、資格バリデーション（§5.5(e)）まで通って確認ページへ進む
    await page.getByRole("button", { name: "確認へ" }).click();
    await expect(page).toHaveURL(/\/entry\/confirm$/, { timeout: 20_000 });
    await expect(page.getByRole("navigation", { name: "申し込みの進み具合" }).getByText("確認")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText(`${teamName}B`, { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`${name}オサム`, { exact: false })).toBeVisible();
    await expect(page.getByText("駐車場を使います")).toBeVisible();

    // 画面幅 375px で横にはみ出さない（§4.3）
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // 「入力に戻って直す」で戻っても入力は消えない（§5.5）
    await page.getByRole("button", { name: "入力に戻って直す" }).first().click();
    await expect(page.getByLabel("運営に伝えること")).toHaveValue("駐車場を使います", { timeout: 20_000 });
    await page.getByRole("button", { name: "確認へ" }).click();
    await expect(page).toHaveURL(/\/entry\/confirm$/, { timeout: 20_000 });

    // 送信 → 完了ページ（§5.7）
    await page.getByRole("button", { name: "申し込む" }).click();
    await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+\?done=1$/, { timeout: 30_000 });
    await expect(page.getByRole("navigation", { name: "申し込みの進み具合" }).getByText("完了")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("申し込みが完了しました")).toBeVisible();
    await expect(page.getByText("混合フリーの部")).toBeVisible();
    await expect(page.getByText(`${name}オサム`, { exact: false })).toBeVisible();

    // 申込完了メールが Mailpit に届く（送信ジョブを待たずに、送信待ちに積まれたことを DB で見る）
    const queued = await owner
      .select({ mailType: mailLogs.mailType, toEmail: mailLogs.toEmail })
      .from(mailLogs)
      .where(eq(mailLogs.toEmail, repEmail));
    expect(queued.some((m) => m.mailType === "entry_completed")).toBe(true);

    // 完了後にブラウザの「戻る」で確認ページに戻っても、再送させずに完了ページへ案内する（§5.5）
    await page.goBack();
    await expect(page.getByText("この申し込みはすでに完了しています")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "申し込みの内容を見る" }).click();
    await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+/, { timeout: 20_000 });
    const rows = await withTenantOn(owner, S, (tx) =>
      tx.select({ id: entries.id }).from(entries).where(eq(entries.tournamentId, tournament.id)),
    );
    expect(rows).toHaveLength(1);

    // 参加チーム一覧に出る（§5.6）。公開のチーム名は申込で入れた名前
    await page.goto(`/${SAWARA_SLUG}/tournaments/${tournament.id}/entries`);
    await expect(page.getByText(`${teamName}B`, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await owner.delete(sessions).where(inArray(sessions.userId, [admin.id, rep.id]));
    await owner.delete(mailLogs).where(eq(mailLogs.toEmail, repEmail));
    await withTenantOn(owner, S, async (tx) => {
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
