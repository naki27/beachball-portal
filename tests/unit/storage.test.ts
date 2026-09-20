import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decryptBackup, encryptForBackup, generateBackupKeyPair } from "@/lib/storage/encrypt";
import { createLocalStorage } from "@/lib/storage/local";
import { assertStorageKey } from "@/lib/storage/types";

// ファイルの保存先とバックアップの暗号化（設計書 §6.3・§6.5「補足」・B-14）
const root = mkdtempSync(join(tmpdir(), "bbp-storage-"));
const storage = createLocalStorage(root, "http://localhost:3000/dev-files");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("ローカルの保存先", () => {
  it("置いて・読んで・一覧にして・消せる", async () => {
    await storage.put("backup", "entries/2026/a.csv.enc", new TextEncoder().encode("あ"));
    await storage.put("backup", "entries/2026/b.csv.enc", new TextEncoder().encode("い"));
    expect(new TextDecoder().decode((await storage.get("backup", "entries/2026/a.csv.enc")) ?? new Uint8Array())).toBe("あ");
    expect(await storage.list("backup", "entries/")).toEqual(["entries/2026/a.csv.enc", "entries/2026/b.csv.enc"]);
    await storage.remove("backup", "entries/2026/a.csv.enc");
    expect(await storage.get("backup", "entries/2026/a.csv.enc")).toBeNull();
  });

  it("保存先の外に書き出せる名前は受け付けない", () => {
    expect(() => assertStorageKey("../../etc/passwd")).toThrow();
    expect(() => assertStorageKey("/etc/passwd")).toThrow();
    expect(() => assertStorageKey("a//b")).toThrow();
    expect(() => assertStorageKey("entries/2026/a.csv.enc")).not.toThrow();
  });

  it("公開用の URL は配信の URL の先頭に続ける", () => {
    expect(storage.publicUrl("documents/abc.pdf")).toBe("http://localhost:3000/dev-files/documents/abc.pdf");
  });
});

describe("バックアップの暗号化（公開鍵方式）", () => {
  it("公開鍵で暗号化し、秘密鍵で元に戻せる", () => {
    const pair = generateBackupKeyPair();
    const text = "申込番号,部,チーム名\r\nA,男子フリーの部,さくら\r\n";
    const sealed = encryptForBackup(pair.publicKey, text);
    // そのままでは中身が読めない
    expect(new TextDecoder().decode(sealed)).not.toContain("さくら");
    expect(new TextDecoder().decode(decryptBackup(pair.privateKey, sealed))).toBe(text);
  });

  it("別の秘密鍵では戻せない。壊れたデータも戻せない", () => {
    const pair = generateBackupKeyPair();
    const other = generateBackupKeyPair();
    const sealed = encryptForBackup(pair.publicKey, "ひみつ");
    expect(() => decryptBackup(other.privateKey, sealed)).toThrow();
    const broken = Uint8Array.from(sealed);
    broken[broken.length - 1] ^= 0xff;
    expect(() => decryptBackup(pair.privateKey, broken)).toThrow();
  });

  it("毎回ちがう暗号文になる（使い捨ての鍵）", () => {
    const pair = generateBackupKeyPair();
    const a = encryptForBackup(pair.publicKey, "同じ中身");
    const b = encryptForBackup(pair.publicKey, "同じ中身");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
