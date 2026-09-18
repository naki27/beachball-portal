// pnpm db:roles — アプリが使う DB のロールを作る（設計書 §5.14「漏れを機構で防ぐ」3・付録 A）
// 管理者（POSTGRES_ADMIN_URL）で接続し、ロールがなければ作り、あればパスワードを合わせる。何度流してもよい
// ここでは DB とスキーマへの入り口の権限だけを付ける。表ごとの権限と RLS はマイグレーションで付ける（A-01・A-03）
import { Client } from "pg";
import { loadEnv, requireEnv } from "../env";

type LoginRole = {
  role: string;
  // パスワードを持つ接続文字列の変数名（ユーザー名がロール名と一致していること）
  urlVar: string;
  // create/alter role に付ける属性
  attributes: string;
};

const LOGIN_ROLES: readonly LoginRole[] = [
  // テーブルの所有者。マイグレーションだけが使う
  { role: "app_owner", urlVar: "MIGRATION_DATABASE_URL", attributes: "login nobypassrls" },
  // アプリ。所有者ではなく BYPASSRLS を持たない（RLS を効かせるため）
  { role: "app_user", urlVar: "DATABASE_URL", attributes: "login nobypassrls" },
  // 日次ジョブ。協会ごとに SET LOCAL して処理する
  { role: "app_job", urlVar: "JOB_DATABASE_URL", attributes: "login nobypassrls" },
  // pg_dump 専用。読み取りだけ（SELECT の付与はマイグレーションで）
  { role: "app_backup", urlVar: "BACKUP_DATABASE_URL", attributes: "login bypassrls" },
];

// SECURITY DEFINER 関数の所有者。ログインできない
const DEFINER_ROLE = "app_definer";

function credentialsFor({ role, urlVar }: LoginRole): { password: string } {
  const url = new URL(requireEnv(urlVar));
  const username = decodeURIComponent(url.username);
  if (username !== role) {
    throw new Error(`${urlVar} のユーザー名が ${role} ではありません（${username}）`);
  }
  const password = decodeURIComponent(url.password);
  if (!password) throw new Error(`${urlVar} にパスワードがありません`);
  return { password };
}

async function ensureRole(client: Client, role: string, attributes: string, password?: string): Promise<"作成" | "更新"> {
  const ident = client.escapeIdentifier(role);
  const exists = await client.query("select 1 from pg_roles where rolname = $1", [role]);
  const created = exists.rowCount === 0;
  if (created) await client.query(`create role ${ident}`);
  const withPassword = password ? ` password ${client.escapeLiteral(password)}` : "";
  await client.query(`alter role ${ident} with ${attributes}${withPassword}`);
  return created ? "作成" : "更新";
}

export async function ensureRoles(adminUrl: string): Promise<void> {
  const dbName = decodeURIComponent(new URL(adminUrl).pathname.slice(1));
  if (!dbName) throw new Error("POSTGRES_ADMIN_URL に DB 名がありません");

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const spec of LOGIN_ROLES) {
      const { password } = credentialsFor(spec);
      const result = await ensureRole(client, spec.role, spec.attributes, password);
      console.log(`${spec.role}: ${result}`);
    }
    console.log(`${DEFINER_ROLE}: ${await ensureRole(client, DEFINER_ROLE, "nologin bypassrls")}`);

    const db = client.escapeIdentifier(dbName);
    const loginRoles = LOGIN_ROLES.map((r) => client.escapeIdentifier(r.role)).join(", ");
    await client.query(`grant connect on database ${db} to ${loginRoles}`);
    // 拡張（pg_trgm・citext）と drizzle のマイグレーション用スキーマを作れるように
    await client.query(`grant create on database ${db} to app_owner`);
    await client.query("grant usage, create on schema public to app_owner");
    await client.query("grant usage on schema public to app_user, app_job, app_backup");
    console.log(`権限: ${dbName} への接続と public スキーマの利用を付けました`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  loadEnv();
  await ensureRoles(requireEnv("POSTGRES_ADMIN_URL"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
