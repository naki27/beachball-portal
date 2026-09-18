import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associations, categoryPresets, platformAdmins, users } from "@/db/schema";
import { MAX_SUPER_ADMINS, parseSuperAdminEmails, SAWARA_ASSOCIATION_ID, seed } from "@/db/seed";
import { DEFAULT_CATEGORY_PRESETS } from "@/lib/presets/default";

// マイグレーション済みの DB（.env の MIGRATION_DATABASE_URL = app_owner）に seed を流す
// CI では空の DB → db:migrate → db:seed → このテスト、の順に通る

const TEST_ADMIN_EMAILS = ["seed-test-1@example.com", "seed-test-2@example.com"];
const db = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });

// このテストが作る運営管理者だけを消す（seed の協会とプリセットは残す）
async function removeTestAdmins(): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.email, TEST_ADMIN_EMAILS));
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await db.delete(platformAdmins).where(inArray(platformAdmins.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

beforeAll(removeTestAdmins);
afterAll(async () => {
  await removeTestAdmins();
  await closeDb(db);
});

describe("seed", () => {
  it("2 回流しても、早良区協会と 18 件の部門プリセットが 1 つずつ", async () => {
    await seed(db);
    await seed(db);

    const sawara = await db.select().from(associations).where(eq(associations.slug, "sawara"));
    expect(sawara).toHaveLength(1);
    expect(sawara[0].id).toBe(SAWARA_ASSOCIATION_ID);
    expect(sawara[0].fiscalYearStartMonth).toBe(4);

    const presets = await db
      .select()
      .from(categoryPresets)
      .where(and(eq(categoryPresets.associationId, SAWARA_ASSOCIATION_ID), isNull(categoryPresets.deletedAt)));
    expect(presets).toHaveLength(18);
    expect(new Set(presets.map((p) => p.code))).toEqual(new Set(DEFAULT_CATEGORY_PRESETS.map((p) => p.code)));
    // 混合の男女比とコート人数は列の既定値
    expect(presets.every((p) => p.isActive && p.courtSize === 4 && p.mixedMinMale === 1 && p.mixedMinFemale === 2)).toBe(
      true,
    );
    expect(presets.filter((p) => p.ruleType === "free").every((p) => p.ruleValue === null)).toBe(true);
  });

  it("SUPER_ADMIN_EMAILS の運営管理者を作り、2 回目は増えない", async () => {
    await seed(db, { superAdminEmails: TEST_ADMIN_EMAILS });
    await seed(db, { superAdminEmails: TEST_ADMIN_EMAILS });

    const admins = await db
      .select({ email: users.email })
      .from(platformAdmins)
      .innerJoin(users, eq(users.id, platformAdmins.userId))
      .where(inArray(users.email, TEST_ADMIN_EMAILS));
    expect(admins.map((row) => row.email).sort()).toEqual(TEST_ADMIN_EMAILS);

    const accounts = await db.select({ id: users.id }).from(users).where(inArray(users.email, TEST_ADMIN_EMAILS));
    expect(accounts).toHaveLength(2);
  });

  it("SUPER_ADMIN_EMAILS は空白と重複を除き、2 名を超えたら止まる", () => {
    expect(parseSuperAdminEmails(undefined)).toEqual([]);
    expect(parseSuperAdminEmails(" a@example.com, B@example.com ,a@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(() => parseSuperAdminEmails("a@example.com,b@example.com,c@example.com")).toThrow(
      `${MAX_SUPER_ADMINS} 名まで`,
    );
  });
});
