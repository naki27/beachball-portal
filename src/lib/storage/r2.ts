import { createHash, createHmac } from "node:crypto";
import {
  assertStorageKey,
  type PutOptions,
  type StorageAdapter,
  type StorageBucket,
  type StorageObjectMeta,
} from "./types";

// Cloudflare R2（S3 互換 API）への保存（設計書 §6.3・`STORAGE_DRIVER=r2`）。本番だけ
// SDK は入れず、署名（AWS Signature Version 4）を自前で付けて fetch する。本物の R2 で通ることは `pnpm storage:check` で確かめる
// バケットごとに資格情報を分ける（§6.5「補足」）。バックアップ用バケットのキーはアプリには渡さず、日次ジョブだけに渡す

export type R2Credentials = { accessKeyId: string; secretAccessKey: string };

// credentials が null = そのバケットのキーを渡されていない（触ろうとしたらその場で止まる）
export type R2BucketConfig = { name: string; credentials: R2Credentials | null };

export type R2Config = {
  accountId: string;
  buckets: Record<StorageBucket, R2BucketConfig>;
  publicBaseUrl: string;
};

const REGION = "auto";
const SERVICE = "s3";

const sha256Hex = (body: Uint8Array | string) => createHash("sha256").update(body).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

// 署名に使う日時（20260920T031500Z / 20260920）
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(credentials: R2Credentials, dateStamp: string): Buffer {
  const date = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const region = hmac(date, REGION);
  const service = hmac(region, SERVICE);
  return hmac(service, "aws4_request");
}

function signedHeaders(
  credentials: R2Credentials,
  method: string,
  host: string,
  path: string,
  query: string,
  payload: Uint8Array | string,
  extra: Record<string, string>,
  now: Date,
): Record<string, string> {
  const { amzDate, dateStamp } = stamps(now);
  const payloadHash = sha256Hex(payload);
  // 署名に入れるヘッダは小文字の名前で持つ（正規化の決まり）
  const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  for (const [name, value] of Object.entries(extra)) headers[name.toLowerCase()] = value;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaderNames = names.join(";");
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaderNames, payloadHash].join("\n");
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(credentials, dateStamp)).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
  };
}

// キーは / ごとにエンコードする（S3 の正規化の決まり）
const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

// 渡されていないキーで触ろうとしたときの文言（どの変数が足りないかだけを出す）
const MISSING_KEY_ENV: Record<StorageBucket, string> = {
  private: "R2_ACCESS_KEY_ID",
  public: "R2_ACCESS_KEY_ID",
  backup: "R2_BACKUP_ACCESS_KEY_ID",
};

export function createR2Storage(config: R2Config, now: () => Date = () => new Date()): StorageAdapter {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;

  function bucketOf(bucket: StorageBucket): { name: string; credentials: R2Credentials } {
    const target = config.buckets[bucket];
    if (!target.credentials) {
      throw new Error(`${bucket} のバケットの鍵がありません（${MISSING_KEY_ENV[bucket]} を渡していない）`);
    }
    return { name: target.name, credentials: target.credentials };
  }

  async function call(
    method: string,
    bucket: StorageBucket,
    key: string,
    query: string,
    payload: Uint8Array,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    if (key) assertStorageKey(key);
    const target = bucketOf(bucket);
    const path = `/${target.name}${key ? `/${encodeKey(key)}` : ""}`;
    const headers = signedHeaders(target.credentials, method, host, path, query, payload, extra, now());
    // Cloudflare は text/plain などを圧縮して返すとき HEAD の応答から content-length を落とす。圧縮させない（署名には含めない）
    return fetch(`https://${host}${path}${query ? `?${query}` : ""}`, {
      method,
      headers: method === "HEAD" ? { ...headers, "accept-encoding": "identity" } : headers,
      body: method === "GET" || method === "DELETE" || method === "HEAD" ? undefined : Buffer.from(payload),
    });
  }

  return {
    driver: "r2",

    async put(bucket, key, body, options?: PutOptions) {
      // Content-Disposition と Cache-Control はオブジェクトに付き、配信時にそのまま返る（§5.9）
      const headers: Record<string, string> = { "content-type": options?.contentType ?? "application/octet-stream" };
      if (options?.contentDisposition) headers["content-disposition"] = options.contentDisposition;
      if (options?.cacheControl) headers["cache-control"] = options.cacheControl;
      const response = await call("PUT", bucket, key, "", body, headers);
      if (!response.ok) throw new Error(`R2 に保存できませんでした（${response.status}）`);
    },

    async get(bucket, key) {
      const response = await call("GET", bucket, key, "", new Uint8Array());
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 から読めませんでした（${response.status}）`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async head(bucket, key): Promise<StorageObjectMeta | null> {
      const response = await call("HEAD", bucket, key, "", new Uint8Array());
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`R2 の情報を取れませんでした（${response.status}）`);
      const length = response.headers.get("content-length");
      return {
        contentType: response.headers.get("content-type"),
        contentDisposition: response.headers.get("content-disposition"),
        cacheControl: response.headers.get("cache-control"),
        size: length === null ? null : Number(length),
      };
    },

    async remove(bucket, key) {
      const response = await call("DELETE", bucket, key, "", new Uint8Array());
      if (!response.ok && response.status !== 404) throw new Error(`R2 から消せませんでした（${response.status}）`);
    },

    async list(bucket, prefix) {
      const query = `list-type=2&prefix=${encodeURIComponent(prefix)}`;
      const response = await call("GET", bucket, "", query, new Uint8Array());
      if (!response.ok) throw new Error(`R2 の一覧を取れませんでした（${response.status}）`);
      const xml = await response.text();
      return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    },

    publicUrl(key) {
      assertStorageKey(key);
      return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    },
  };
}
