import { createLocalStorage } from "./local";
import { createR2Storage } from "./r2";
import type { StorageAdapter, StorageBucket } from "./types";

// 保存先の選び方（設計書 §6.3）。`STORAGE_DRIVER` が `r2` なら R2、それ以外はローカル
// 呼ぶ側はこの関数だけを使い、driver の違いを知らない

// .env.example は値を空にして置いてあるので、空文字も「未設定」として既定値を使う（?? ではなく ||）
export const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_DIR || ".local-storage";

let cached: StorageAdapter | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} がありません（.env.example を見て .env に書く）`);
  return value;
}

export function createStorage(): StorageAdapter {
  const publicBaseUrl = process.env.PUBLIC_FILES_BASE_URL || "http://localhost:3000/dev-files";
  if (process.env.STORAGE_DRIVER !== "r2") return createLocalStorage(LOCAL_STORAGE_ROOT, publicBaseUrl);

  const bucket = required("R2_BUCKET");
  const buckets: Record<StorageBucket, string> = {
    private: bucket,
    public: required("R2_PUBLIC_BUCKET"),
    // バックアップは別のバケット（全員の生年月日を含むため・§6.5「補足」）
    backup: process.env.R2_BACKUP_BUCKET ?? `${bucket}-backup`,
  };
  return createR2Storage({
    accountId: required("R2_ACCOUNT_ID"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    buckets,
    publicBaseUrl,
  });
}

export function getStorage(): StorageAdapter {
  cached ??= createStorage();
  return cached;
}

export type { StorageAdapter, StorageBucket } from "./types";
