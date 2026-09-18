// pnpm db:seed — 初期データを入れる（中身は src/db/seed.ts）。マイグレーションのあとに流す。何度流してもよい
import { closeDb, createDb } from "../client";
import { loadEnv, requireEnv } from "../env";
import { parseSuperAdminEmails, seed } from "../seed";

async function main(): Promise<void> {
  loadEnv();
  const db = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  try {
    const result = await seed(db, { superAdminEmails: parseSuperAdminEmails(process.env.SUPER_ADMIN_EMAILS) });
    // メールアドレスはログに出さない
    console.log(
      `早良区協会（sawara）: あり。部門プリセット: ${result.presetsInserted} 件を追加。運営管理者: ${result.superAdmins} 名`,
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
