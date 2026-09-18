// 初期データ（設計書 付録 A「初期データ」・§7.0）。何度流しても同じ結果になる（すでにある行は触らない）
// app_owner（MIGRATION_DATABASE_URL）で実行する（docs/adr/0001）。入口は src/db/scripts/seed.ts
import { and, eq, isNull } from "drizzle-orm";
import { DEFAULT_CATEGORY_PRESETS } from "../lib/presets/default";
import type { Db } from "./client";
import { associations, categoryPresets, platformAdmins, users } from "./schema";
import { withTenantOn } from "./tenant";

// 早良区協会（seed で作る最初のテナント。以後の協会は運営管理者が /platform から作る）
export const SAWARA_ASSOCIATION_ID = "00000000-0000-0000-0000-000000000001";
export const SAWARA_SLUG = "sawara";

// 運営管理者は 2 名以内（§3.1）
export const MAX_SUPER_ADMINS = 2;

export type SeedOptions = {
  // SUPER_ADMIN_EMAILS の中身。アカウントがなければ users を作る
  superAdminEmails?: readonly string[];
};

export type SeedResult = {
  presetsInserted: number;
  superAdmins: number;
};

// SUPER_ADMIN_EMAILS（カンマ区切り）を読む。空白と重複を除き、2 名を超えたら止める
export function parseSuperAdminEmails(value: string | undefined): string[] {
  const emails = (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(emails)];
  if (unique.length > MAX_SUPER_ADMINS) {
    throw new Error(`SUPER_ADMIN_EMAILS は ${MAX_SUPER_ADMINS} 名までです（${unique.length} 件あります）`);
  }
  return unique;
}

export async function seed(db: Db, options: SeedOptions = {}): Promise<SeedResult> {
  const superAdminEmails = options.superAdminEmails ?? [];
  if (superAdminEmails.length > MAX_SUPER_ADMINS) {
    throw new Error(`運営管理者は ${MAX_SUPER_ADMINS} 名までです`);
  }

  // category_presets はテナントの表（RLS は所有者にも効く）ので、早良区協会に固定したトランザクションで入れる
  return withTenantOn(db, SAWARA_ASSOCIATION_ID, async (tx) => {
    // 協会はプリセットより先に作る
    await tx
      .insert(associations)
      .values({ id: SAWARA_ASSOCIATION_ID, name: "早良区協会", slug: SAWARA_SLUG, fiscalYearStartMonth: 4 })
      .onConflictDoNothing({ target: associations.id });

    // 部門プリセット: code がまだないものだけ入れる（協会が画面で直した行は触らない）
    const existing = await tx
      .select({ code: categoryPresets.code })
      .from(categoryPresets)
      .where(and(eq(categoryPresets.associationId, SAWARA_ASSOCIATION_ID), isNull(categoryPresets.deletedAt)));
    const have = new Set(existing.map((row) => row.code));
    const missing = DEFAULT_CATEGORY_PRESETS.filter((preset) => !have.has(preset.code));
    if (missing.length > 0) {
      await tx
        .insert(categoryPresets)
        .values(missing.map((preset) => ({ associationId: SAWARA_ASSOCIATION_ID, ...preset })));
    }

    // 運営管理者: アカウントがなければ作り、platform_admins に入れる
    for (const email of superAdminEmails) {
      const [found] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)));
      const userId = found?.id ?? (await tx.insert(users).values({ email }).returning({ id: users.id }))[0].id;
      await tx
        .insert(platformAdmins)
        .values({ userId, note: "seed" })
        .onConflictDoNothing({ target: platformAdmins.userId });
    }

    return { presetsInserted: missing.length, superAdmins: superAdminEmails.length };
  });
}
