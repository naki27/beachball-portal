import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type BackupKeyPair, generateBackupKeyPair } from "./encrypt";
import { LOCAL_STORAGE_ROOT } from "./index";

// バックアップの暗号化に使う公開鍵（設計書 §6.5「補足」）
// 本番: `BACKUP_ENCRYPTION_KEY`（公開鍵だけ。秘密鍵はジョブに渡さない）
// ローカル: `.local-storage/backup-test-key.json` に**テスト用の鍵**を作って使う（中身を確かめられるように秘密鍵も置く）

const TEST_KEY_PATH = join(LOCAL_STORAGE_ROOT, "backup-test-key.json");

export function localTestKeyPair(path: string = TEST_KEY_PATH): BackupKeyPair {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as BackupKeyPair;
  const pair = generateBackupKeyPair();
  mkdirSync(dirname(path), { recursive: true });
  // ローカルだけのテスト用の鍵（.local-storage/ は Git に入らない）
  writeFileSync(path, `${JSON.stringify(pair, null, 2)}\n`, { mode: 0o600 });
  return pair;
}

export function backupPublicKey(): string {
  const fromEnv = process.env.BACKUP_ENCRYPTION_KEY;
  if (fromEnv) return fromEnv;
  if (process.env.STORAGE_DRIVER === "r2") {
    throw new Error("環境変数 BACKUP_ENCRYPTION_KEY がありません（バックアップの公開鍵）");
  }
  return localTestKeyPair().publicKey;
}
