import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRecord, formatLine, redactQuery, REDACTED, shouldSkipPath } from "@/lib/access-log/line";
import {
  CURRENT_FILE_NAME,
  createFileSink,
  needsRotation,
  prune,
  rotatedName,
} from "@/lib/access-log/sink";
import { hashSessionId } from "@/lib/auth/session-hash";

// 操作ログ（docs/adr/0027）。日本時間で動くこと（TZ=UTC と TZ=Asia/Tokyo の両方で流す）

const at = new Date("2026-09-21T03:34:56.789Z"); // 日本時間 2026-09-21 12:34:56.789

function facts(overrides: Partial<Parameters<typeof buildRecord>[0]> = {}) {
  return {
    at,
    method: "GET",
    path: "/sawara/teams/abc",
    search: "",
    sessionId: null,
    actionId: null,
    ip: null,
    userAgent: null,
    ...overrides,
  };
}

describe("記録しないパス", () => {
  it("静的ファイルと死活監視は記録しない", () => {
    expect(shouldSkipPath("/_next/static/chunk.js")).toBe(true);
    expect(shouldSkipPath("/api/health")).toBe(true);
  });

  it("画面と API は記録する", () => {
    expect(shouldSkipPath("/sawara/teams")).toBe(false);
    expect(shouldSkipPath("/api/sawara/members/suggest")).toBe(false);
  });
});

describe("クエリの伏せ字", () => {
  it("個人情報になりうる値は伏せる", () => {
    expect(redactQuery("?q=山田")).toBe(`q=${REDACTED}`);
    expect(redactQuery("?name=山田&teamName=A")).toBe(`name=${REDACTED}&teamName=${REDACTED}`);
    expect(redactQuery("?email=a@example.com")).toBe(`email=${REDACTED}`);
    expect(redactQuery("?code=123456&token=x")).toBe(`code=${REDACTED}&token=${REDACTED}`);
  });

  it("調べるのに要る値は残す", () => {
    expect(redactQuery("?page=2&year=2026")).toBe("page=2&year=2026");
  });

  it("クエリがなければ undefined", () => {
    expect(redactQuery("")).toBeUndefined();
    expect(redactQuery("?")).toBeUndefined();
  });
});

describe("1 行の組み立て", () => {
  it("時刻は日本時間、協会のスラッグを取り出す", () => {
    const record = buildRecord(facts());
    expect(record.at).toBe("2026-09-21T12:34:56.789+09:00");
    expect(record.slug).toBe("sawara");
    expect(record.method).toBe("GET");
    expect(record.path).toBe("/sawara/teams/abc");
  });

  it("API のパスからも協会のスラッグを取り出す", () => {
    expect(buildRecord(facts({ path: "/api/sawara/members/suggest", method: "POST" })).slug).toBe("sawara");
  });

  it("協会の画面でなければスラッグを載せない", () => {
    expect(buildRecord(facts({ path: "/mypage" })).slug).toBeUndefined();
  });

  it("セッションは DB と同じハッシュにする（生の値は残さない）", () => {
    const record = buildRecord(facts({ sessionId: "raw-session-id" }));
    expect(record.session).toBe(hashSessionId("raw-session-id"));
    expect(JSON.stringify(record)).not.toContain("raw-session-id");
  });

  it("長すぎる User-Agent は切る", () => {
    const record = buildRecord(facts({ userAgent: "a".repeat(1000) }));
    expect(record.ua?.length).toBe(257); // 256 文字 + 省略の記号
  });

  it("JSON Lines になる", () => {
    const line = formatLine(buildRecord(facts({ actionId: "7f3a" })));
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toMatchObject({ action: "7f3a", path: "/sawara/teams/abc" });
  });
});

describe("退避するかの判定", () => {
  const max = 100;

  it("空のファイルは退避しない", () => {
    expect(needsRotation({ size: 0, mtime: at }, at, max)).toBe(false);
  });

  it("上限の大きさを超えたら退避する", () => {
    expect(needsRotation({ size: max, mtime: at }, at, max)).toBe(true);
  });

  it("日本時間の月が変わったら退避する", () => {
    const lastMonth = new Date("2026-08-31T20:00:00Z"); // 日本時間 9/1 5:00 → 同じ月
    expect(needsRotation({ size: 10, mtime: lastMonth }, at, max)).toBe(false);
    const reallyLastMonth = new Date("2026-08-31T10:00:00Z"); // 日本時間 8/31 19:00
    expect(needsRotation({ size: 10, mtime: reallyLastMonth }, at, max)).toBe(true);
  });

  it("同じ月で上限より小さければ退避しない", () => {
    expect(needsRotation({ size: 10, mtime: new Date("2026-09-01T00:00:00Z") }, at, max)).toBe(false);
  });
});

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "access-log-"));
}

describe("ファイルへの書き出し", () => {
  it("書いた行が access.log に残る", async () => {
    const dir = await tempDir();
    const sink = createFileSink({ dir });
    sink.write("a\n");
    sink.write("b\n");
    await sink.flush();
    expect(await readFile(join(dir, CURRENT_FILE_NAME), "utf8")).toBe("a\nb\n");
  });

  it("大きさが上限を超えたら退避して新しいファイルに書く", async () => {
    const dir = await tempDir();
    const sink = createFileSink({ dir, maxBytes: 3 });
    sink.write("aaaa\n");
    await sink.flush();
    sink.write("b\n");
    await sink.flush();

    expect(await readFile(join(dir, CURRENT_FILE_NAME), "utf8")).toBe("b\n");
    const rotated = (await readdir(dir)).filter((name) => name !== CURRENT_FILE_NAME);
    expect(rotated).toHaveLength(1);
    expect(await readFile(join(dir, rotated[0]), "utf8")).toBe("aaaa\n");
  });

  it("月が変わったら退避する", async () => {
    const dir = await tempDir();
    const current = join(dir, CURRENT_FILE_NAME);
    await writeFile(current, "先月の分\n", "utf8");
    const lastMonth = new Date("2026-08-20T00:00:00Z");
    await utimes(current, lastMonth, lastMonth);

    const sink = createFileSink({ dir });
    sink.write("今月の分\n");
    await sink.flush();

    expect(await readFile(current, "utf8")).toBe("今月の分\n");
    const rotated = (await readdir(dir)).filter((name) => name !== CURRENT_FILE_NAME);
    expect(rotated).toHaveLength(1);
    expect(await readFile(join(dir, rotated[0]), "utf8")).toBe("先月の分\n");
  });

  it("書けなくても呼ぶ側は止まらない", async () => {
    // 置き場所と同じ名前のファイルがあると、フォルダを作れない
    const dir = await tempDir();
    const blocked = join(dir, "ファイルであってフォルダではない");
    await writeFile(blocked, "x", "utf8");

    const sink = createFileSink({ dir: blocked });
    sink.write("a\n");
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});

describe("世代の数を保つ", () => {
  it("同じ秒に重なっても名前の順が古い順になる", async () => {
    const dir = await tempDir();
    const now = new Date("2026-09-21T03:34:56Z");
    const first = await rotatedName(dir, now);
    await writeFile(join(dir, first), "1", "utf8");
    const second = await rotatedName(dir, now);
    expect(first).toBe("access-20260921-123456-01.log");
    expect(second).toBe("access-20260921-123456-02.log");
    expect([second, first].sort()).toEqual([first, second]);
  });

  it("6 世代を超えた古いものを消す", async () => {
    const dir = await tempDir();
    const names = Array.from({ length: 8 }, (_, i) => `access-2026${String(i + 1).padStart(2, "0")}01-000000-01.log`);
    for (const name of names) await writeFile(join(dir, name), name, "utf8");
    await writeFile(join(dir, CURRENT_FILE_NAME), "今の分", "utf8");

    const removed = await prune(dir, 6);

    expect(removed).toEqual(names.slice(0, 2));
    const left = (await readdir(dir)).sort();
    expect(left).toEqual([CURRENT_FILE_NAME, ...names.slice(2)].sort());
    expect((await stat(join(dir, CURRENT_FILE_NAME))).isFile()).toBe(true);
  });
});
