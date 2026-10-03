import { existsSync } from "node:fs";

const loaded = new Set<string>();

// `.env` を読む。Next.js の外で動くもの（DB のスクリプト・drizzle-kit・Vitest）が使う。Next.js 自身は `.env` を自分で読む
// Node 24 の process.loadEnvFile を使う（dotenv は入れない）。すでに入っている環境変数は上書きしない
// ファイルを指定すると、そのファイルを読む（本番の値を手元で使うスクリプト用。例: .env.production.local）
export function loadEnv(file = ".env"): boolean {
  if (loaded.has(file)) return true;
  if (!existsSync(file)) return false;
  loaded.add(file);
  process.loadEnvFile(file);
  return true;
}

// 必須の環境変数を読む。なければ変数の名前だけを出して止まる（値はログに出さない）
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} がありません（.env.example を見て .env に書く）`);
  }
  return value;
}
