import { expect, test } from "@playwright/test";

// 共通部品の一覧（開発用）。スマホ幅で横にはみ出さないことと、スクリーンショットを残す（§4.3「検証」）
test("/dev/ui が開き、横にはみ出さない。部品が動く", async ({ page }, testInfo) => {
  await page.goto("/dev/ui");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("部品の一覧（開発用）");
  await expect(page).toHaveTitle(/部品の一覧（開発用）｜/);

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

test("フッタにプライバシーポリシーと利用規約への案内がある", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute("href", "/privacy");
  await expect(page.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
});

test("タブの題名: 協会のページは「ページ名｜協会名」", async ({ page }) => {
  await page.goto("/sawara");
  await expect(page).toHaveTitle("早良区協会");
  await page.goto("/sawara/admin");
  await expect(page).toHaveTitle("管理｜早良区協会");
  await expect(page.getByRole("link", { name: "早良区協会" }).first()).toHaveAttribute("href", "/sawara");
});
