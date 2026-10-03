// 本番のマイグレーション（設計書 §6.6 の手順 3・X-02）。Cloud Run Jobs の「migrate」から動かす
// drizzle-kit（開発用。devDependencies）ではなく drizzle-orm の migrate() を呼ぶので、本番のイメージに drizzle-kit を入れなくてよい
// 使うのは MIGRATION_DATABASE_URL（app_owner）だけ。続けて初期データ（seed）も流す（何度流してもよい作り）
// ログに個人情報を出さない（seed はメールアドレスを出さない）
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, createDb, type Db } from "../client";
import { loadEnv, requireEnv } from "../env";
import { parseSuperAdminEmails, seed } from "../seed";

// マイグレーションの SQL の置き場所。standalone（.next/standalone）でも、まとめたジョブ（dist/jobs）でも
// 同じ位置に置くので、作業ディレクトリからの相対で指す（docs/ops.md §12）
const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER || "src/db/migrations";

export async function runMigrations(db: Db, folder = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}

async function main(): Promise<void> {
  loadEnv();
  const db = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
  try {
    await runMigrations(db);
    console.log(`マイグレーション: 済み（${MIGRATIONS_FOLDER}）`);
    const result = await seed(db, { superAdminEmails: parseSuperAdminEmails(process.env.SUPER_ADMIN_EMAILS) });
    console.log(`初期データ: 部のプリセット ${result.presetsInserted} 件、運営管理者 ${result.superAdmins} 名`);
  } finally {
    await closeDb(db);
  }
}

main().catch((error: unknown) => {
  // drizzle のエラー文にはクエリの引数が入るので、名前と文だけを出す（引数は出さない）
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exit(1);
});
