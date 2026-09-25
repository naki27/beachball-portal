import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertStorageKey, type PutOptions, type StorageAdapter, type StorageBucket } from "./types";

// ローカルのファイル保存（設計書 §6.3・`STORAGE_DRIVER=local`）。`.local-storage/{private,public,backup}/`
// 本番では使わない。公開用のファイルは開発時だけのルート（/dev-files/…）が返す（§5.9・C-02）
// Content-Type などは R2 ならオブジェクトに付くが、ローカルでは横に `<キー>.meta.json` を置いて代わりにする

const META_SUFFIX = ".meta.json";

type LocalMeta = { contentType?: string; contentDisposition?: string; cacheControl?: string };

function contentTypeByExtension(key: string): string {
  if (key.toLowerCase().endsWith(".pdf")) return "application/pdf";
  if (key.toLowerCase().endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

export function createLocalStorage(root: string, publicBaseUrl: string): StorageAdapter {
  const pathOf = (bucket: StorageBucket, key: string) => {
    assertStorageKey(key);
    return join(root, bucket, key);
  };

  return {
    driver: "local",

    async put(bucket, key, body, options?: PutOptions) {
      const path = pathOf(bucket, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      const meta: LocalMeta = {};
      if (options?.contentType) meta.contentType = options.contentType;
      if (options?.contentDisposition) meta.contentDisposition = options.contentDisposition;
      if (options?.cacheControl) meta.cacheControl = options.cacheControl;
      if (Object.keys(meta).length > 0) await writeFile(`${path}${META_SUFFIX}`, JSON.stringify(meta));
      else await rm(`${path}${META_SUFFIX}`, { force: true });
    },

    async get(bucket, key) {
      try {
        return new Uint8Array(await readFile(pathOf(bucket, key)));
      } catch {
        return null; // ないときは null（呼ぶ側が 404 にする）
      }
    },

    async remove(bucket, key) {
      const path = pathOf(bucket, key);
      await rm(path, { force: true });
      await rm(`${path}${META_SUFFIX}`, { force: true });
    },

    async list(bucket, prefix) {
      const base = join(root, bucket);
      const found: string[] = [];
      const walk = async (dir: string, current: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const key = current ? `${current}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(join(dir, entry.name), key);
          else if (key.startsWith(prefix) && !key.endsWith(META_SUFFIX)) found.push(key);
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

export type LocalFile = { body: Uint8Array; contentType: string; contentDisposition: string | null };

// 開発時だけのルート（/dev-files/…）が公開用のファイルを返すために読む。キーが不正・ファイルがなければ null
export async function readLocalFile(root: string, bucket: StorageBucket, key: string): Promise<LocalFile | null> {
  try {
    assertStorageKey(key);
    const path = join(root, bucket, key);
    const body = new Uint8Array(await readFile(path));
    const meta: LocalMeta = await readFile(`${path}${META_SUFFIX}`, "utf8")
      .then((text) => JSON.parse(text) as LocalMeta)
      .catch(() => ({}));
    return {
      body,
      contentType: meta.contentType ?? contentTypeByExtension(key),
      contentDisposition: meta.contentDisposition ?? null,
    };
  } catch {
    return null;
  }
}
