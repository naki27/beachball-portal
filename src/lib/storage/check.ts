import { randomBytes } from "node:crypto";
import type { StorageAdapter, StorageBucket } from "./types";

// `pnpm storage:check` の中身（X-01）。3 つのバケットに置く・情報を取る・読む・一覧に出る・消すを順に確かめ、
// 公開用のバケットでは Content-Type・Content-Disposition・Cache-Control がそのまま返ることも見る
// 本物の R2 に対して人が手元の PC で実行する。中身は確かめ用の短い文字列だけ（個人情報は置かない）

export const CHECK_PREFIX = "storage-check/";
// 公開用のファイルに付ける 3 つ（§5.9・ADR 0026 → 0033。資料の公開と同じ値を使う）
export const PUBLIC_CONTENT_TYPE = "application/pdf";
export const PUBLIC_CACHE_CONTROL = "public, max-age=3600";
export const PUBLIC_CONTENT_DISPOSITION = "inline; filename*=UTF-8''storage-check.pdf";

export type CheckStep = { label: string; ok: boolean; detail?: string };
export type CheckResult = { steps: CheckStep[]; ok: boolean };

export type CheckOptions = {
  // 確かめるバケット（既定は 3 つ全部）。バックアップ用のキーを渡していないときは外して実行する
  buckets?: readonly StorageBucket[];
  // 公開用の URL を実際に取ってみるか（PUBLIC_FILES_BASE_URL の配信。X-05 の前は届かないので外せる）
  fetchPublicUrl?: boolean;
  fetchImpl?: typeof fetch;
};

const ALL_BUCKETS: readonly StorageBucket[] = ["private", "public", "backup"];

function uniqueKey(extension: string): string {
  return `${CHECK_PREFIX}${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
}

// 1 つの手順を走らせて結果を記録する。失敗しても次へ進む（どこまで通ったかを人が見たい）
async function step(steps: CheckStep[], label: string, run: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = await run();
    steps.push({ label, ok: true, ...(detail ? { detail } : {}) });
    return true;
  } catch (error) {
    steps.push({ label, ok: false, detail: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function checkBucket(storage: StorageAdapter, bucket: StorageBucket, steps: CheckStep[]): Promise<void> {
  const key = uniqueKey("txt");
  const body = new TextEncoder().encode(`storage-check ${key}`);

  const put = await step(steps, `${bucket}: 置く`, () => storage.put(bucket, key, body, { contentType: "text/plain; charset=utf-8" }));
  if (!put) return;

  await step(steps, `${bucket}: 情報を取る`, async () => {
    const meta = await storage.head(bucket, key);
    expect(meta !== null, "置いたはずのファイルが見つかりません");
    expect(meta?.size === body.byteLength, `大きさが違います（${meta?.size} ≠ ${body.byteLength}）`);
    return `${meta?.contentType ?? "（Content-Type なし）"} / ${meta?.size} バイト`;
  });

  await step(steps, `${bucket}: 読む`, async () => {
    const got = await storage.get(bucket, key);
    expect(got !== null, "読み出せません");
    expect(Buffer.from(got ?? []).equals(Buffer.from(body)), "中身が変わっています");
  });

  await step(steps, `${bucket}: 一覧に出る`, async () => {
    const keys = await storage.list(bucket, CHECK_PREFIX);
    expect(keys.includes(key), "一覧に出てきません");
    return `${keys.length} 件`;
  });

  await step(steps, `${bucket}: 消す`, async () => {
    await storage.remove(bucket, key);
    expect((await storage.get(bucket, key)) === null, "消したのに読めます");
  });
}

// 公開用のバケット: 3 つのヘッダがオブジェクトに付き、配信でもそのまま返ることを見る
async function checkPublicHeaders(storage: StorageAdapter, steps: CheckStep[], options: CheckOptions): Promise<void> {
  const key = uniqueKey("pdf");
  const body = new TextEncoder().encode("%PDF-1.4\n% storage-check\n");
  const put = await step(steps, "public: ヘッダを付けて置く", () =>
    storage.put("public", key, body, {
      contentType: PUBLIC_CONTENT_TYPE,
      contentDisposition: PUBLIC_CONTENT_DISPOSITION,
      cacheControl: PUBLIC_CACHE_CONTROL,
    }),
  );
  if (!put) return;

  try {
    await step(steps, "public: 付けたヘッダがそのまま付いている", async () => {
      const meta = await storage.head("public", key);
      expect(meta !== null, "置いたはずのファイルが見つかりません");
      expect(meta?.contentType === PUBLIC_CONTENT_TYPE, `Content-Type が ${meta?.contentType ?? "なし"}`);
      expect(meta?.contentDisposition === PUBLIC_CONTENT_DISPOSITION, `Content-Disposition が ${meta?.contentDisposition ?? "なし"}`);
      expect(meta?.cacheControl === PUBLIC_CACHE_CONTROL, `Cache-Control が ${meta?.cacheControl ?? "なし"}`);
    });

    if (options.fetchPublicUrl) {
      const fetchImpl = options.fetchImpl ?? fetch;
      await step(steps, "public: 配信の URL から取れる", async () => {
        const response = await fetchImpl(storage.publicUrl(key));
        expect(response.ok, `配信が ${response.status} を返しました`);
        expect(response.headers.get("content-type") === PUBLIC_CONTENT_TYPE, `Content-Type が ${response.headers.get("content-type") ?? "なし"}`);
        expect(
          response.headers.get("content-disposition") === PUBLIC_CONTENT_DISPOSITION,
          `Content-Disposition が ${response.headers.get("content-disposition") ?? "なし"}`,
        );
        expect(response.headers.get("cache-control") === PUBLIC_CACHE_CONTROL, `Cache-Control が ${response.headers.get("cache-control") ?? "なし"}`);
        return storage.publicUrl(key);
      });
    }
  } finally {
    // 公開用のバケットに確かめ用のファイルを残さない
    await step(steps, "public: 後始末", () => storage.remove("public", key));
  }
}

export async function runStorageCheck(storage: StorageAdapter, options: CheckOptions = {}): Promise<CheckResult> {
  const steps: CheckStep[] = [];
  const buckets = options.buckets ?? ALL_BUCKETS;
  for (const bucket of buckets) await checkBucket(storage, bucket, steps);
  if (buckets.includes("public")) await checkPublicHeaders(storage, steps, options);
  return { steps, ok: steps.every((s) => s.ok) };
}

export function formatCheckResult(result: CheckResult): string {
  const lines = result.steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.label}${s.detail ? `: ${s.detail}` : ""}`);
  const failed = result.steps.filter((s) => !s.ok).length;
  lines.push(result.ok ? `すべて通りました（${result.steps.length} 件）` : `${failed} 件が失敗しました（${result.steps.length} 件中）`);
  return lines.join("\n");
}
