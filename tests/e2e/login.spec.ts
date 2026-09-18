import { expect } from "@playwright/test";
import { test } from "./fixtures";

// ログイン①: 確認番号の発行（設計書 §5.1・§9.2・§11.3）。メールは Mailpit（コンテナの中から http://mailpit:8025）で確かめる
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";

test("メールアドレスを入れると確認番号のメールが届き、番号の入力画面になる", async ({ page, request }, testInfo) => {
  const email = `e2e-login-${testInfo.workerIndex}-${Date.now()}@example.com`;
  // 失敗の原因を追えるように、ブラウザ側のエラーをテストの出力に流す
  page.on("pageerror", (e) => console.log(`[pageerror] ${String(e.stack ?? e).slice(0, 1200)}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 1200)}`);
  });
  await page.goto("/login?next=%2Fsawara");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ログイン");
  await expect(page.getByText("早良区協会のページに戻ります")).toBeVisible();
  // 同意の一文のリンク（フッタにも同じリンクがあるので、フォームの中に絞る）
  const form = page.locator("form");
  await expect(form.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms");
  await expect(form.getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute("href", "/privacy");

  await page.locator("form[data-hydrated]").waitFor(); // ハイドレーション前に押すと素の form 送信になる
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "確認番号を送る" }).click();

  await expect(page).toHaveURL(/\/login\/code/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("確認番号を入力してください");
  await expect(page.getByText(`${email} にメールを送りました`)).toBeVisible();
  await expect(page.getByLabel("確認番号（6 けた）")).toHaveAttribute("inputmode", "numeric");
  await expect(page.getByLabel("確認番号（6 けた）")).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.getByText(/あと \d+ 秒で、もう一度送れます/)).toBeVisible();
  await expect(page.getByRole("link", { name: "メールが届かないとき" })).toHaveAttribute("href", "/login/help");

  // Mailpit に「【早良区協会】確認番号 123456」の形で届く
  const search = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  const result = (await search.json()) as { messages: { Subject: string }[] };
  expect(result.messages.length).toBe(1);
  expect(result.messages[0].Subject).toMatch(/^【早良区協会】確認番号 \d{6}$/);

  // タブを開き直しても番号の入力から再開できる（sessionStorage）
  await page.reload();
  await expect(page.getByText(`${email} にメールを送りました`)).toBeVisible();
});

test("形式が違うメールアドレスは欄の下に理由が出る", async ({ page }) => {
  await page.goto("/login");
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("メールアドレス").fill("taro@example");
  await page.getByRole("button", { name: "確認番号を送る" }).click();
  await expect(page.getByText("メールアドレスの形で入力してください")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("メールが届かないときの案内", async ({ page }) => {
  await page.goto("/login/help");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("メールが届かないとき");
  await expect(page.getByText("迷惑メールフォルダを見てください")).toBeVisible();
  await expect(page.getByRole("button", { name: "このドメインをコピー" })).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toBeVisible();
  await expect(page.getByRole("button", { name: "このアドレスに送り直す" })).toBeVisible();
  await expect(page.getByRole("link", { name: "問い合わせフォーム" })).toHaveAttribute("href", "/contact");
  await expect(page.getByText(/電話/)).toHaveCount(0);
});
