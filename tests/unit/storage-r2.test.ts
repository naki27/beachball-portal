import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage } from "@/lib/storage";
import { createR2Storage, type R2Config } from "@/lib/storage/r2";

// R2（S3 互換 API）の署名とバケットごとの資格情報（設計書 §6.3・§6.5「補足」・X-01）
// 本物の R2 につながることは `pnpm storage:check` で確かめる。ここでは fetch を差し替えて、
// 「どのバケットをどの鍵で触るか」と「付けたヘッダ」だけを見る

const APP = { accessKeyId: "APPKEYID", secretAccessKey: "app-secret" };
const BACKUP = { accessKeyId: "BACKUPKEYID", secretAccessKey: "backup-secret" };

function configWith(backupCredentials: typeof BACKUP | null): R2Config {
  return {
    accountId: "account",
    buckets: {
      private: { name: "bbp-documents", credentials: APP },
      public: { name: "bbp-public", credentials: APP },
      backup: { name: "bbp-backup", credentials: backupCredentials },
    },
    publicBaseUrl: "https://files.example.workers.dev",
  };
}

type Call = { url: string; init: RequestInit };

let calls: Call[] = [];

function stubFetch(response: () => Response): void {
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  });
}

const authorizationOf = (call: Call) => String((call.init.headers as Record<string, string>).authorization);

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("バケットごとの資格情報", () => {
  it("資料は アプリの鍵、バックアップは バックアップ用の鍵で署名する", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    const storage = createR2Storage(configWith(BACKUP), () => new Date("2026-10-03T03:15:00.000Z"));

    await storage.put("private", "documents/a.pdf", new Uint8Array([1]), { contentType: "application/pdf" });
    await storage.put("backup", "daily/2026-10-03.sql.enc", new Uint8Array([2]));

    expect(calls[0].url).toBe("https://account.r2.cloudflarestorage.com/bbp-documents/documents/a.pdf");
    expect(authorizationOf(calls[0])).toContain("Credential=APPKEYID/20261003/auto/s3/aws4_request");
    expect(calls[1].url).toBe("https://account.r2.cloudflarestorage.com/bbp-backup/daily/2026-10-03.sql.enc");
    expect(authorizationOf(calls[1])).toContain("Credential=BACKUPKEYID/20261003/auto/s3/aws4_request");
    // 署名そのものも鍵ごとに違う
    expect(authorizationOf(calls[0])).not.toBe(authorizationOf(calls[1]));
  });

  it("バックアップ用の鍵がなければ、触る前に止まる（アプリの鍵で代わりに触らない）", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    const storage = createR2Storage(configWith(null));

    await expect(storage.put("backup", "daily/x.enc", new Uint8Array([1]))).rejects.toThrow("R2_BACKUP_ACCESS_KEY_ID");
    await expect(storage.get("backup", "daily/x.enc")).rejects.toThrow("R2_BACKUP_ACCESS_KEY_ID");
    expect(calls).toHaveLength(0);
  });

  it("資料用のバケットは鍵がなくても動く（アプリにバックアップ用の鍵を渡さない）", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    const storage = createR2Storage(configWith(null));
    await expect(storage.put("public", "documents/a.pdf", new Uint8Array([1]))).resolves.toBeUndefined();
  });
});

describe("公開用のヘッダ", () => {
  it("置くときに Content-Type・Content-Disposition・Cache-Control を付ける", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    const storage = createR2Storage(configWith(BACKUP));
    await storage.put("public", "documents/a.pdf", new Uint8Array([1]), {
      contentType: "application/pdf",
      contentDisposition: "inline; filename*=UTF-8''%E7%B5%84%E5%90%88%E3%81%9B.pdf",
      cacheControl: "public, max-age=3600",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["cache-control"]).toBe("public, max-age=3600");
    // 署名の対象にも入っている（R2 はこれをそのまま返す）
    expect(authorizationOf(calls[0])).toContain("content-disposition");
  });

  it("情報を取ると付いているヘッダが返る。なければ null", async () => {
    const found = new Response("", {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "inline; filename=\"a.pdf\"",
        "cache-control": "public, max-age=3600",
        "content-length": "12",
      },
    });
    stubFetch(() => found);
    const storage = createR2Storage(configWith(BACKUP));
    expect(await storage.head("public", "documents/a.pdf")).toEqual({
      contentType: "application/pdf",
      contentDisposition: 'inline; filename="a.pdf"',
      cacheControl: "public, max-age=3600",
      size: 12,
    });
    expect(calls[0].init.method).toBe("HEAD");

    calls = [];
    stubFetch(() => new Response("", { status: 404 }));
    expect(await createR2Storage(configWith(BACKUP)).head("public", "documents/none.pdf")).toBeNull();
  });
});

describe("環境変数からの組み立て", () => {
  const ENV_NAMES = [
    "STORAGE_DRIVER",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_PUBLIC_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BACKUP_BUCKET",
    "R2_BACKUP_ACCESS_KEY_ID",
    "R2_BACKUP_SECRET_ACCESS_KEY",
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of ENV_NAMES) saved[name] = process.env[name];
    process.env.STORAGE_DRIVER = "r2";
    process.env.R2_ACCOUNT_ID = "account";
    process.env.R2_BUCKET = "bbp-documents";
    process.env.R2_PUBLIC_BUCKET = "bbp-public";
    process.env.R2_ACCESS_KEY_ID = APP.accessKeyId;
    process.env.R2_SECRET_ACCESS_KEY = APP.secretAccessKey;
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("R2_BACKUP_BUCKET が空文字なら、既定の名前（R2_BUCKET + -backup）に戻る", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    process.env.R2_BACKUP_BUCKET = "";
    process.env.R2_BACKUP_ACCESS_KEY_ID = BACKUP.accessKeyId;
    process.env.R2_BACKUP_SECRET_ACCESS_KEY = BACKUP.secretAccessKey;

    await createStorage().put("backup", "daily/x.enc", new Uint8Array([1]));
    expect(calls[0].url).toContain("/bbp-documents-backup/daily/x.enc");
    expect(authorizationOf(calls[0])).toContain(`Credential=${BACKUP.accessKeyId}/`);
  });

  it("バックアップ用の鍵を渡していなければ、バックアップ用バケットは触れない", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    delete process.env.R2_BACKUP_ACCESS_KEY_ID;
    delete process.env.R2_BACKUP_SECRET_ACCESS_KEY;

    const storage = createStorage();
    await expect(storage.put("backup", "daily/x.enc", new Uint8Array([1]))).rejects.toThrow("R2_BACKUP_ACCESS_KEY_ID");
    expect(calls).toHaveLength(0);
  });
});
