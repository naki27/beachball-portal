import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { and, eq, like } from "drizzle-orm";
import { closeDb, createDb } from "../../src/db/client";
import { loadEnv, requireEnv } from "../../src/db/env";
import { associationAdmins, deletionLogs, members, sessions, teamAdmins, teamMembers, teams, users } from "../../src/db/schema";
import { SAWARA_ASSOCIATION_ID } from "../../src/db/seed";
import { withTenantOn } from "../../src/db/tenant";
import { normalizeName } from "../../src/lib/normalize";

// 削除済みデータ（設計書 §5.16）: チームを削除 → 削除済みデータに出る → 復元すると元どおり → もう一度削除して完全に削除
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";
type Req = Parameters<Parameters<typeof test>[2]>[0]["request"];

async function latestCode(request: Req, email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email} subject:確認番号`)}`);
    const body = (await res.json()) as { messages?: { Subject: string }[] };
    const code = body.messages?.[0]?.Subject.match(/(\d{6})$/);
    if (code) return code[1];
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

test("テナント管理者がチームを削除 → 削除済みデータに出る → 復元 → もう一度削除して完全に削除", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  loadEnv();
  const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  const stamp = `${testInfo.workerIndex}-${Date.now()}`;
  const adminEmail = `e2e-trash-admin-${stamp}@example.com`;
  const captainEmail = `e2e-trash-captain-${stamp}@example.com`;
  const tag = `E2Eゴミ箱${stamp}`;
  const [admin] = await owner.insert(users).values({ email: adminEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const [captain] = await owner.insert(users).values({ email: captainEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  const teamId = await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.insert(associationAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, userId: admin.id });
    const [team] = await tx
      .insert(teams)
      .values({ associationId: SAWARA_ASSOCIATION_ID, name: `${tag} チーム`, createdBy: captain.id })
      .returning({ id: teams.id });
    await tx.insert(teamAdmins).values({ associationId: SAWARA_ASSOCIATION_ID, teamId: team.id, userId: captain.id });
    const [member] = await tx
      .insert(members)
      .values({
        associationId: SAWARA_ASSOCIATION_ID,
        name: `${tag} 太郎`,
        birthDate: "1993-03-03",
        sex: "male",
        nameNormalized: normalizeName(`${tag} 太郎`),
      })
      .returning({ id: members.id });
    await tx.insert(teamMembers).values({ associationId: SAWARA_ASSOCIATION_ID, teamId: team.id, memberId: member.id });
    return team.id;
  });

  try {
    // チーム管理から削除（論理）
    await login(page, request, adminEmail, `/sawara/admin/teams/${teamId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${tag} チーム`, { timeout: 15_000 });
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByRole("button", { name: "このチームを削除する" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(page).toHaveURL(/\/sawara\/admin\/teams$/, { timeout: 15_000 });

    // 削除済みデータに出る
    await page.goto("/sawara/admin");
    await page.getByRole("link", { name: "削除済みデータ" }).click();
    await expect(page).toHaveURL(/\/sawara\/admin\/trash$/, { timeout: 15_000 });
    const card = page.locator("article", { hasText: `${tag} チーム` });
    await expect(card).toContainText("選手一覧の行 1 件");

    // 復元すると元どおり（選手一覧の行も戻る）
    await page.locator("[data-hydrated]").first().waitFor();
    await card.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("を元に戻しました", { exact: false })).toBeVisible({ timeout: 15_000 });
    // 画面の作り直し（router.refresh）が終わってから次の画面へ
    await expect(page.locator("article", { hasText: `${tag} チーム` })).toHaveCount(0, { timeout: 15_000 });
    await page.goto(`/sawara/teams/${teamId}/members`);
    await expect(page.getByText(`${tag} 太郎`)).toBeVisible({ timeout: 15_000 });

    // もう一度削除 → 完全に削除（2 段階の確認と理由）
    await page.goto(`/sawara/admin/teams/${teamId}`);
    await page.locator("[data-hydrated]").first().waitFor();
    await page.getByRole("button", { name: "このチームを削除する" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    // 削除が終わって一覧に戻るのを待ってから開く（途中で移ると送信が中断される）
    await expect(page).toHaveURL(/\/sawara\/admin\/teams$/, { timeout: 15_000 });
    await page.goto("/sawara/admin/trash");
    const again = page.locator("article", { hasText: `${tag} チーム` });
    await page.locator("[data-hydrated]").first().waitFor();
    await again.getByRole("button", { name: "完全に削除する" }).click();
    await expect(again.getByText("本当に完全に削除しますか？")).toBeVisible();
    // 理由の種類（人物を消すときの申込の記録の扱いが変わる・§5.16）とメモ
    await again.getByLabel("理由の種類").selectOption("mistake");
    await again.getByLabel("理由のメモ").fill("誤登録");
    await again.getByRole("button", { name: "完全に削除する" }).click();
    await expect(page.getByText("を完全に削除しました", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("article", { hasText: `${tag} チーム` })).toHaveCount(0, { timeout: 15_000 });

    // DB からも消え、記録だけが残る（中身は残さない）
    const rows = await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) => tx.select().from(teams).where(eq(teams.id, teamId)));
    expect(rows).toHaveLength(0);
    const [log] = await withTenantOn(owner, SAWARA_ASSOCIATION_ID, (tx) =>
      tx.select().from(deletionLogs).where(eq(deletionLogs.recordId, teamId)),
    );
    // 記録の理由は「理由の種類：メモ」（§5.16）
    expect(log).toMatchObject({ tableName: "teams", reason: "誤登録：誤登録", deletedBy: admin.id });
    expect(JSON.stringify(log)).not.toContain(tag);
  } finally {
    await owner.delete(sessions).where(eq(sessions.userId, admin.id));
    await owner.delete(sessions).where(eq(sessions.userId, captain.id));
    await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
      await tx.delete(deletionLogs).where(eq(deletionLogs.deletedBy, admin.id));
      await tx.delete(teams).where(eq(teams.id, teamId));
      await tx.delete(members).where(and(eq(members.associationId, SAWARA_ASSOCIATION_ID), like(members.nameNormalized, `${normalizeName(tag)}%`)));
      await tx.delete(associationAdmins).where(eq(associationAdmins.userId, admin.id));
    });
    await owner.delete(users).where(eq(users.id, admin.id));
    await owner.delete(users).where(eq(users.id, captain.id));
    await closeDb(owner);
  }
});
