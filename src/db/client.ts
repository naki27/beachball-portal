import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "./env";
import * as schema from "./schema";

// アプリ用の接続プール（DATABASE_URL = app_user。設計書 §5.14・§6.3）
// 最初に使うときに作る。開発中は Next.js がモジュールを読み直すので、globalThis に置いてプールを増やさない
type Db = ReturnType<typeof createDb>;
const store = globalThis as unknown as { __beachballDb?: Db };

const DEFAULT_POOL_MAX = 5;

function createDb() {
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: Number(process.env.DB_POOL_MAX ?? DEFAULT_POOL_MAX),
  });
  return drizzle(pool, { schema });
}

export function getDb(): Db {
  store.__beachballDb ??= createDb();
  return store.__beachballDb;
}

export function getPool(): Pool {
  return getDb().$client;
}

// テストとスクリプトの終わりに閉じる（開いたままだとプロセスが終わらない）
export async function closeDb(): Promise<void> {
  const db = store.__beachballDb;
  store.__beachballDb = undefined;
  await db?.$client.end();
}
