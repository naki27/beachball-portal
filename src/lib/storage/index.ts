import { createLocalStorage } from "./local";
import { createR2Storage, type R2BucketConfig, type R2Credentials } from "./r2";
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

// 空文字は「未設定」として扱う（.env.example は値を空にして置いてある）
function optionalCredentials(keyIdVar: string, secretVar: string): R2Credentials | null {
  const accessKeyId = process.env[keyIdVar] || "";
  const secretAccessKey = process.env[secretVar] || "";
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

export function createStorage(): StorageAdapter {
  const publicBaseUrl = process.env.PUBLIC_FILES_BASE_URL || "http://localhost:3000/dev-files";
  if (process.env.STORAGE_DRIVER !== "r2") return createLocalStorage(LOCAL_STORAGE_ROOT, publicBaseUrl);

  const bucket = required("R2_BUCKET");
  // 資料用の 2 つのバケットはアプリのキー、バックアップ用は別のキー（§6.5「補足」・X-01）。
  // バックアップ用のキーはアプリには渡さないので、ここでは「ない」のを許し、触ろうとしたときに止める
  const appCredentials: R2Credentials = {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  };
  const buckets: Record<StorageBucket, R2BucketConfig> = {
    private: { name: bucket, credentials: appCredentials },
    public: { name: required("R2_PUBLIC_BUCKET"), credentials: appCredentials },
    // バックアップは別のバケット（全員の生年月日を含むため・§6.5「補足」）
    backup: {
      name: process.env.R2_BACKUP_BUCKET || `${bucket}-backup`,
      credentials: optionalCredentials("R2_BACKUP_ACCESS_KEY_ID", "R2_BACKUP_SECRET_ACCESS_KEY"),
    },
  };
  return createR2Storage({ accountId: required("R2_ACCOUNT_ID"), buckets, publicBaseUrl });
}

export function getStorage(): StorageAdapter {
  cached ??= createStorage();
  return cached;
}

export type { StorageAdapter, StorageBucket } from "./types";
