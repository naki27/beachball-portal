import { expect } from "@playwright/test";
import { test } from "./fixtures";

// 共通部品の一覧（開発用）。スマホ幅で横にはみ出さないことと、スクリーンショットを残す（§4.3「検証」）
test("/dev/ui が開き、横にはみ出さない。部品が動く", async ({ page }, testInfo) => {
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("部品の一覧（開発用）");
  await expect(page).toHaveTitle(/部品の一覧（開発用）｜/);
  await page.locator("[data-hydrated]").waitFor(); // ハイドレーション前に押すと何も起きない

  // 送信中: 文字が変わり、押せなくなる
  const submit = page.getByRole("button", { name: /申し込む/ });
  await submit.click();
  await expect(page.getByRole("button", { name: "送信しています…" })).toBeDisabled();

  // 入力の誤り: 上部の要約と欄の下の理由
  await page.getByRole("button", { name: "入力を確かめる" }).click();
  await expect(page.getByText("2 か所に入力の誤りがあります")).toBeVisible();
  await expect(page.getByText("メールアドレスの形で入力してください").last()).toBeVisible();

  // 元に戻す
  await page.getByRole("button", { name: "選手一覧から外す" }).click();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByRole("button", { name: "選手一覧から外す" })).toBeVisible();

  // 電波の帯
  await page.getByRole("button", { name: "電波が切れたことにする" }).click();
  await expect(page.getByText("電波が届いていません。入力した内容は残っています")).toBeVisible();
  await page.getByRole("button", { name: "つながったことにする" }).click();
  await expect(page.getByText("つながりました")).toBeVisible();

  // 一時保存: 打って開き直すと戻る
  await page.getByLabel(/メモ/).fill("下書きです");
  await expect(page.getByText(/保存しました（/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/メモ/)).toHaveValue("下書きです");
  await page.getByRole("button", { name: /一時保存を消す/ }).click();
  await expect(page.getByLabel(/メモ/)).toHaveValue("");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.screenshot({ path: testInfo.outputPath("dev-ui.png"), fullPage: true });
});

// 節目の演出（ADR 0028・§4.5 原則 1 の例外・原則 5）
// 「視差効果を減らす」が ON なら紙吹雪は出ず、チェックと文字だけが残る
test("節目の演出: 視差効果を減らすと紙吹雪が出ず、文字は残る", async ({ page }) => {
  await page.goto("/dev/ui");
  const celebration = page.getByText("申し込みが完了しました");
  await expect(celebration).toBeVisible();
  const confetti = page.locator(".bb-confetti");
  await expect(confetti).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByText("申し込みが完了しました")).toBeVisible();
  await expect(page.locator(".bb-confetti")).toBeHidden();
});

test("フッタからプライバシーポリシーと利用規約を開ける（ログインしていなくても）", async ({ page }) => {
  await page.goto("/sawara");
  await expect(page.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
  await page.getByRole("link", { name: "プライバシーポリシー" }).click();
  await expect(page).toHaveURL(/\/privacy$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "プライバシーポリシー", level: 1 })).toBeVisible();
  // サイト名は置き換えて入る。版は TERMS_VERSION と同じ
  await expect(page.getByText("ビーチボール大会申し込みサイト（以下「本サービス」）", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("版: 2027-01-31")).toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  // 375px でも横にはみ出さない（表は表の中だけで横に動く）
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("link", { name: "利用規約" }).click();
  await expect(page).toHaveURL(/\/terms$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "利用規約", level: 1 })).toBeVisible();
  await expect(page.getByText("第12条（準拠法・裁判所）")).toBeVisible();
});

test("タブの題名: 協会のページは「ページ名｜協会名」", async ({ page }) => {
  await page.goto("/sawara");
  await expect(page).toHaveTitle("早良区協会");
  await page.goto("/sawara/admin");
  await expect(page).toHaveTitle("管理｜早良区協会");
  await expect(page.getByRole("link", { name: "早良区協会" }).first()).toHaveAttribute("href", "/sawara");
});

test("生年月日（和暦）: 昭和5年と平成5年を入れ比べる。年齢の確認・元号の範囲外", async ({ page }) => {
  await page.goto("/dev/ui");
  await page.locator("[data-hydrated]").waitFor();
  const eras = page.getByRole("radiogroup", { name: "生年月日の元号" });
  const demo = page.getByTestId("birth-demo");

  // 既定は昭和。昭和5年4月1日 → 1930 年・90 歳を超えるので「合っていますか？」、押すまで次へ進めない
  await expect(eras.getByRole("radio", { name: "昭和" })).toBeChecked();
  await page.getByLabel("年", { exact: true }).fill("5");
  await page.getByLabel("月", { exact: true }).fill("4");
  await page.getByLabel("日", { exact: true }).fill("1");
  await expect(page.getByText(/^（1930年）・\d+歳$/)).toBeVisible();
  await expect(page.getByText(/^\d+歳で合っていますか？$/)).toBeVisible();
  await expect(demo).toContainText("進めない");

  // 平成に切り替える → 1993 年。確認は要らず、次へ進める。確認ページの表示
  await eras.getByText("平成", { exact: true }).click();
  await expect(page.getByText(/^（1993年）・\d+歳$/)).toBeVisible();
  await expect(page.getByText(/合っていますか？/)).toHaveCount(0);
  await expect(demo).toContainText("1993-04-01");
  await expect(demo).toContainText("1993年（平成5年）4月1日");
  await expect(demo).toContainText("進める");

  // 昭和に戻して「はい、合っています」→ 次へ進める
  await eras.getByText("昭和", { exact: true }).click();
  await page.getByRole("button", { name: "はい、合っています" }).click();
  await expect(demo).toContainText("1930-04-01");
  await expect(demo).not.toContainText("進めない");

  // 元号の範囲外はその場で誤り
  await page.getByLabel("年", { exact: true }).fill("65");
  await expect(page.getByText("昭和は64年までです")).toBeVisible();
  await expect(page.getByLabel("年", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

// 選ぶ行（U-07・§4.5「内容が変わった」）。チェックすると面の色が変わり、件数もその場で変わる
test("選ぶ行: チェックすると面の色が変わり、件数がその場で変わる", async ({ page }) => {
  await page.goto("/dev/ui");
  const label = page.locator("label.bb-choice").first();
  const before = await label.evaluate((el) => getComputedStyle(el).backgroundColor);
  await label.getByRole("checkbox").check();
  await expect(page.getByText("2人中1人を選んでいます")).toBeVisible();
  await expect.poll(() => label.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(before);
});

// ページの入れ替え（U-07・ADR 0031）。対応しているブラウザでだけ View Transitions が走る（未対応でも操作は同じ）
test("ページを移ると本文がクロスフェードする（対応ブラウザだけ）", async ({ page }) => {
  await page.addInitScript(() => {
    const counter = window as unknown as { __viewTransitions: number };
    counter.__viewTransitions = 0;
    const original = document.startViewTransition?.bind(document);
    if (original) {
      document.startViewTransition = (options?: ViewTransitionUpdateCallback | StartViewTransitionOptions) => {
        counter.__viewTransitions += 1;
        return original(options);
      };
    }
  });
  await page.goto("/privacy");
  const supported = await page.evaluate(() => typeof document.startViewTransition === "function");
  test.skip(!supported, "このブラウザは View Transitions に対応していない");

  await page.getByRole("link", { name: "利用規約" }).click();
  await expect(page).toHaveURL(/\/terms$/, { timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __viewTransitions: number }).__viewTransitions))
    .toBeGreaterThan(0);
});
