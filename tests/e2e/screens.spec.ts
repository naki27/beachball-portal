import { expect, type Page, type TestInfo } from "@playwright/test";
import { eq, inArray, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, entries, mailLogs, members, sessions, teams, tournaments, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "../../src/lib/admin/categories";
import { createTournament } from "../../src/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "../../src/lib/authz";
import { submitEntry } from "../../src/lib/entries/submit-entry";
import { listCategoryPresets } from "../../src/lib/repo/category-presets";
import { addPlayer } from "../../src/lib/teams/roster";
import { registerTeam } from "../../src/lib/teams/teams";
import { normalizeName } from "../../src/lib/normalize";
import { test } from "./fixtures";

// UI 刷新の仕上げ（U-06）。主要な 10 画面を 375 / 768 / 1280 で開き、
// 文字サイズ 100% / 150% / 200% のそれぞれで、はみ出し・タップ領域を確かめてスクリーンショットを残す（設計書 §4.3「検証」・§12「動作確認の範囲」）
//
// スクリーンショットは test-results/… に出る（`pnpm test:e2e --project=chromium-1280x800 tests/e2e/screens.spec.ts`）
const S = SAWARA_ASSOCIATION_ID;
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

// 3 つの幅（§4.3）と、文字サイズ拡大（§12。らくらくスマートフォンや文字サイズ最大の端末を想定）
const WIDTHS = [375, 768, 1280] as const;
const FONT_SCALES = [100, 150, 200] as const;
// タップ領域（§12.1・WCAG 2.2 の 2.5.8 は 24px、この画面は 44px を目標にする）
const MIN_TAP = 44;

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

type Small = { text: string; w: number; h: number };

// 押せるもののうち、文の中のリンク（WCAG 2.2 の「インライン」の例外）と隠している要素を除いて測る
async function smallTargets(page: Page): Promise<Small[]> {
  return page.evaluate((min) => {
    const found: { text: string; w: number; h: number }[] = [];
    const nodes = document.querySelectorAll<HTMLElement>('a[href], button, input:not([type="hidden"]), select, textarea, summary');
    for (const el of nodes) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      // 文の中のリンク（display: inline）は例外
      if (el.tagName === "A" && style.display === "inline") continue;
      // チェックボックス・ラジオは、囲んでいる label ごと押せる。押す相手の大きさで測る
      const input = el as HTMLInputElement;
      const target = (input.type === "checkbox" || input.type === "radio") && el.closest("label") ? el.closest("label")! : el;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // 読み上げにだけ出す入力（sr-only）。押す相手は囲んでいる label なので測らない
      if (el.classList.contains("sr-only")) continue;
      // 端数（枠線・行間）で 43.99px になることがあるので丸めてから比べる
      if (Math.round(rect.height) >= min && Math.round(rect.width) >= min) continue;
      found.push({ text: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 24), w: Math.round(rect.width), h: Math.round(rect.height) });
    }
    return found;
  }, MIN_TAP);
}

// 横にはみ出した量と、はみ出している要素（直せるように、いちばん内側から）
async function overflowing(page: Page): Promise<{ over: number; elements: { tag: string; cls: string; text: string; right: number }[] }> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - limit;
    const found: { tag: string; cls: string; text: string; right: number; depth: number }[] = [];
    if (over > 0) {
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        // チェックボックス・ラジオは、囲んでいる label ごと押せる。押す相手の大きさで測る
      const input = el as HTMLInputElement;
      const target = (input.type === "checkbox" || input.type === "radio") && el.closest("label") ? el.closest("label")! : el;
      const rect = target.getBoundingClientRect();
        if (rect.width === 0 || (rect.right <= limit + 0.5 && rect.left >= -0.5)) continue;
        let depth = 0;
        for (let node = el.parentElement; node; node = node.parentElement) depth++;
        found.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: (el.textContent || "").trim().slice(0, 24), right: Math.round(rect.right), depth });
      }
    }
    found.sort((a, b) => b.depth - a.depth);
    return { over, elements: found.slice(0, 5).map((f) => ({ tag: f.tag, cls: f.cls, text: f.text, right: f.right })) };
  });
}

// ページの入れ替え（View Transitions・ADR 0031）が終わるまで待つ。半透明の途中の状態を撮らないため
async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () =>
        !document
          .getAnimations()
          .some((a) => a.effect instanceof KeyframeEffect && (a.effect.pseudoElement ?? "").startsWith("::view-transition")),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {});
}

// 1 画面を 3 つの幅 × 3 つの文字サイズで開いて確かめ、スクリーンショットを残す
async function checkScreen(page: Page, testInfo: TestInfo, label: string, path: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 667 : 800 });
    for (const scale of FONT_SCALES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
      // 文字サイズ拡大のエミュレーション。大きさはすべて rem なので、根の文字サイズを変えれば端末の設定と同じ効き方になる
      if (scale !== 100) await page.addStyleTag({ content: `html { font-size: ${(16 * scale) / 100}px }` });

      const wide = await overflowing(page);
      expect(wide.over, `${label} が ${width}px・文字 ${scale}% で ${wide.over}px はみ出した: ${JSON.stringify(wide.elements)}`).toBeLessThanOrEqual(0);

      // タップ領域は文字サイズを変えても縮まない。等倍のときだけ見れば足りる
      if (scale === 100) {
        const small = await smallTargets(page);
        expect(small, `${label}（${width}px）に ${MIN_TAP}px 未満の操作がある: ${JSON.stringify(small)}`).toEqual([]);
      }

      await settled(page);
      await page.screenshot({ path: testInfo.outputPath(`${label}-${width}-${scale}.png`), fullPage: true });
    }
  }
}

test("主要な 10 画面が 375 / 768 / 1280 と文字サイズ 150% / 200% で崩れない", async ({ page, request }, testInfo) => {
  // 10 画面 × 3 幅 × 3 文字サイズ＋ログイン 2 回
  test.setTimeout(600_000);
  test.skip(testInfo.project.name !== "chromium-1280x800", "幅はこのテストの中で変えるので、1 つのプロジェクトだけで流す");
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const tag = `E2E画面${stamp}`;
  const repEmail = `e2e-screens-rep-${stamp}@example.com`;
  const adminEmail = `e2e-screens-admin-${stamp}@example.com`;

  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [rep] = await owner.insert(users).values({ email: repEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: admin.id }));
  const asAdmin: Principal & { userId: string } = { ...ANONYMOUS, userId: admin.id, sessionState: "active" };
  const asRep: Principal & { userId: string } = { ...ANONYMOUS, userId: rep.id, sessionState: "active" };

  try {
    // 大会 1 つ（受付中・部あり）、チーム 1 つ（選手 5 人）、申込 1 件
    const presets = await withTenantOn(app, S, (tx) => listCategoryPresets(tx, S, { onlyActive: true }));
    const tournament = await createTournament(app, asAdmin, S, {
      name: `${tag} 大会`,
      eventDate: dayFrom(60),
      ageReferenceDate: dayFrom(60),
      venue: "早良体育館",
      description: "参加費は 1 チーム 3,000 円です。当日、受付でお支払いください。",
      entryStartDate: dayFrom(-5),
      entryEndDate: dayFrom(10),
      teamSizeMin: "4",
      teamSizeMax: "8",
      maxEntries: "",
      status: "open",
    });
    await addCategoriesFromPresets(app, asAdmin, S, tournament.id, {
      presetIds: presets.filter((p) => ["m_free", "w_free", "x_free"].includes(p.code)).map((p) => p.id),
      mixedNotation: "kanji",
    });
    const team = await registerTeam(app, S, rep.id, {
      name: `${tag} チーム`,
      kana: null,
      contactEmail: null,
      contactPhone: null,
      membershipRenewalTarget: true,
    });
    const roster: string[] = [];
    for (const p of [
      { name: `${tag} 一郎`, kana: "いちろう", birthDate: "1958-04-12", sex: "male" as const, refereeGrade: "a", refereeNo: "123456" },
      { name: `${tag} 二郎`, kana: "じろう", birthDate: "1972-06-21", sex: "male" as const, refereeGrade: "b" },
      { name: `${tag} 三郎`, kana: "さぶろう", birthDate: "1988-09-30", sex: "male" as const },
      { name: `${tag} 四郎`, kana: "しろう", birthDate: "1991-01-08", sex: "male" as const },
      { name: `${tag} 五郎`, kana: "ごろう", birthDate: "1949-07-19", sex: "male" as const },
    ]) {
      roster.push((await addPlayer(app, asRep, S, team.id, p)).memberId);
    }
    // 申込 1 件（管理画面の申込一覧を空にしない）
    const cats = (await getCategoriesForAdmin(app, asAdmin, S, tournament.id)).categories;
    await submitEntry(app, asRep, S, tournament.id, {
      teamId: team.id,
      newTeamName: "",
      teamName: `${tag} チーム`,
      categoryId: cats[0].id,
      slots: roster.slice(0, 4).map((memberId, i) => ({
        kind: "pick",
        memberId,
        name: [`${tag} 一郎`, `${tag} 二郎`, `${tag} 三郎`, `${tag} 四郎`][i],
        kana: null,
        birthDate: ["1958-04-12", "1972-06-21", "1988-09-30", "1991-01-08"][i],
        sex: "male",
      })),
      note: "",
      token: crypto.randomUUID(),
    });

    // 1〜2. 未ログインで見える公開ページ
    await checkScreen(page, testInfo, "01-協会トップ", "/sawara");
    await checkScreen(page, testInfo, "02-大会詳細", `/sawara/tournaments/${tournament.id}`);

    // 3〜7. 代表者
    await login(page, request, repEmail, "/mypage");
    await expect(page).toHaveURL(/\/mypage$/, { timeout: 20_000 });
    await checkScreen(page, testInfo, "03-マイページ", "/mypage");
    await checkScreen(page, testInfo, "04-チーム", `/sawara/teams/${team.id}`);
    await checkScreen(page, testInfo, "05-選手一覧", `/sawara/teams/${team.id}/members`);
    await checkScreen(page, testInfo, "06-選手の追加", `/sawara/teams/${team.id}/members/new`);
    await checkScreen(page, testInfo, "07-申込の入力", `/sawara/tournaments/${tournament.id}/entry`);

    // 8〜10. テナント管理者
    await page.goto("/api/auth/logout");
    await login(page, request, adminEmail, "/sawara/admin");
    await expect(page).toHaveURL(/\/sawara\/admin$/, { timeout: 20_000 });
    await checkScreen(page, testInfo, "08-管理のトップ", "/sawara/admin");
    await checkScreen(page, testInfo, "09-申込一覧", `/sawara/admin/tournaments/${tournament.id}/entries`);
    await checkScreen(page, testInfo, "10-メンバー管理", "/sawara/admin/members");
  } finally {
    await owner.delete(sessions).where(inArray(sessions.userId, [rep.id, admin.id]));
    await owner.delete(mailLogs).where(like(mailLogs.toEmail, `e2e-screens-%-${stamp}@example.com`));
    await withTenantOn(owner, S, async (tx) => {
      await tx.delete(entries).where(eq(entries.createdBy, rep.id));
      await tx.delete(tournaments).where(eq(tournaments.createdBy, admin.id));
      await tx.delete(teams).where(eq(teams.createdBy, rep.id));
      await tx.delete(members).where(like(members.nameNormalized, `${normalizeName(tag)}%`));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(users).where(inArray(users.id, [rep.id, admin.id]));
    await closeDb(owner);
    await closeDb(app);
  }
});
