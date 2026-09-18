import { expect, test } from "@playwright/test";

// ログイン②: 照合とセッション（設計書 §9.2・§5.2）。番号は Mailpit から取り出す
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";

async function latestCode(request: Parameters<Parameters<typeof test>[2]>[0]["request"], email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: { Subject: string }[] };
    const m = body.messages?.[0]?.Subject.match(/(\d{6})$/);
    if (m) return m[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("確認番号のメールが届かない");
}

test("番号を入れるとログインし、元のページに戻る。開き直してもログインしたまま。ログアウトで切れる", async ({ page, request, context }, testInfo) => {
  const email = `e2e-verify-${testInfo.workerIndex}-${Date.now()}@example.com`;
  page.on("pageerror", (e) => console.log(`[pageerror] ${String(e.stack ?? e).slice(0, 1200)}`));

  // 協会のページの「ログイン」から
  await page.goto("/sawara/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("このページを見るにはログインが必要です");
  await page.getByRole("link", { name: "ログインする" }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fsawara%2Fadmin/);
  await page.locator("form[data-hydrated]").waitFor();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "確認番号を送る" }).click();
  await expect(page).toHaveURL(/\/login\/code/);

  // 間違えると理由と残り回数。番号は消えずに全選択
  const codeField = page.getByLabel("確認番号（6 けた）");
  await codeField.fill("000000");
  await expect(page.getByText(/番号が違います。メールに書かれた 6 けたの数字を入れてください（あと4回）/)).toBeVisible();
  await expect(codeField).toHaveValue("000000");

  // 正しい番号を入れると自動で照合され、元のページ（/sawara/admin）へ。管理者ではないので「協会の管理者だけ」の 403
  const code = await latestCode(request, email);
  await codeField.fill(code);
  await expect(page).toHaveURL(/\/sawara\/admin$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("このページは協会の管理者だけが見られます", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible({ timeout: 15_000 });

  // Cookie は HttpOnly・SameSite=Lax・Path=/
  const session = (await context.cookies()).find((c) => c.name === "session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(session?.path).toBe("/");

  // 開き直してもログインしたまま
  await page.goto("/sawara");
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible({ timeout: 15_000 });

  // ログアウトで切れる
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: "ログイン" })).toBeVisible({ timeout: 15_000 });
  await page.goto("/sawara/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("このページを見るにはログインが必要です");
});
