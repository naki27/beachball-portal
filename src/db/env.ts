import { existsSync } from "node:fs";

let loaded = false;

// `.env` を読む。Next.js の外で動くもの（DB のスクリプト・drizzle-kit・Vitest）が使う。Next.js 自身は `.env` を自分で読む
// Node 24 の process.loadEnvFile を使う（dotenv は入れない）。すでに入っている環境変数は上書きしない
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  if (existsSync(".env")) process.loadEnvFile(".env");
}

// 必須の環境変数を読む。なければ変数の名前だけを出して止まる（値はログに出さない）
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} がありません（.env.example を見て .env に書く）`);
  }
  return value;
}
