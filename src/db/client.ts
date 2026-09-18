import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { requireEnv } from "./env";
import * as schema from "./schema";

const DEFAULT_POOL_MAX = 5;

// 接続プールと Drizzle を作る。列名は snake_case（drizzle.config.ts と同じ casing にする）
export function createDb(connectionString: string, options: { max?: number } = {}) {
  const pool = new Pool({
    connectionString,
    max: options.max ?? Number(process.env.DB_POOL_MAX ?? DEFAULT_POOL_MAX),
  });
  return drizzle(pool, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;

// アプリ用（DATABASE_URL = app_user。設計書 §5.14・§6.3）
// 最初に使うときに作る。開発中は Next.js がモジュールを読み直すので、globalThis に置いてプールを増やさない
const store = globalThis as unknown as { __beachballDb?: Db };

export function getDb(): Db {
  store.__beachballDb ??= createDb(requireEnv("DATABASE_URL"));
  return store.__beachballDb;
}

export function getPool(): Pool {
  return getDb().$client;
}

// 開いたままだとプロセスが終わらないので、テストとスクリプトの終わりに閉じる
// 引数なしならアプリ用のプール。createDb で自分で作ったものは渡して閉じる
export async function closeDb(db?: Db): Promise<void> {
  if (db) {
    await db.$client.end();
    return;
  }
  const app = store.__beachballDb;
  store.__beachballDb = undefined;
  await app?.$client.end();
}
