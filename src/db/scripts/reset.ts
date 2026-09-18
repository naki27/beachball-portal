// pnpm db:reset — ローカルの DB を消して作り直す。このあと package.json の scripts で db:roles → db:migrate が続く
// 本番では動かない: NODE_ENV=production、または DB のホストが db / localhost / 127.0.0.1 以外なら止まる
import { Client } from "pg";
import { loadEnv, requireEnv } from "../env";

const LOCAL_HOSTS = new Set(["db", "localhost", "127.0.0.1"]);

function assertLocal(url: URL): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("NODE_ENV=production では db:reset は動かしません");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`ローカル以外のホスト（${url.hostname}）には db:reset を使えません`);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const adminUrl = new URL(requireEnv("POSTGRES_ADMIN_URL"));
  assertLocal(adminUrl);
  const dbName = decodeURIComponent(adminUrl.pathname.slice(1));
  if (!dbName) throw new Error("POSTGRES_ADMIN_URL に DB 名がありません");

  // 消す DB には接続できないので、保守用の postgres DB につなぐ
  adminUrl.pathname = "/postgres";
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const db = client.escapeIdentifier(dbName);
    // with (force): つながっている接続（dev サーバーなど）を切ってから消す
    await client.query(`drop database if exists ${db} with (force)`);
    await client.query(`create database ${db}`);
    console.log(`${dbName}: 消して作り直しました`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
