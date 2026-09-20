import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertStorageKey, type StorageAdapter, type StorageBucket } from "./types";

// ローカルのファイル保存（設計書 §6.3・`STORAGE_DRIVER=local`）。`.local-storage/{private,public,backup}/`
// 本番では使わない。公開用のファイルは開発時だけのルートで返す（§5.9・C-02）

export function createLocalStorage(root: string, publicBaseUrl: string): StorageAdapter {
  const pathOf = (bucket: StorageBucket, key: string) => {
    assertStorageKey(key);
    return join(root, bucket, key);
  };

  return {
    driver: "local",

    // ローカルでは Content-Type を保存しない（配信は開発時だけのルートが拡張子から決める・§5.9）
    async put(bucket, key, body) {
      const path = pathOf(bucket, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },

    async get(bucket, key) {
      try {
        return new Uint8Array(await readFile(pathOf(bucket, key)));
      } catch {
        return null; // ないときは null（呼ぶ側が 404 にする）
      }
    },

    async remove(bucket, key) {
      await rm(pathOf(bucket, key), { force: true });
    },

    async list(bucket, prefix) {
      const base = join(root, bucket);
      const found: string[] = [];
      const walk = async (dir: string, current: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const key = current ? `${current}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(join(dir, entry.name), key);
          else if (key.startsWith(prefix)) found.push(key);
        }
      };
      await walk(base, "");
      return found.sort();
    },

    publicUrl(key) {
      assertStorageKey(key);
      return `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
    },
  };
}
