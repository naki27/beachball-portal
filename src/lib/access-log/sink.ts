import { access, appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { formatTimestampTokyo } from "@/lib/date";

// 操作ログの書き出し先（docs/adr/0027）
// - file: ローカルと自前サーバー向け。月が変わるか 100 MB を超えたら退避し、6 世代（半年）残す
// - stdout: 本番（Cloud Run）向け。ファイルはインスタンスが終わると消えるので、Cloud Logging に任せる
// リクエストを待たせないため、書き込みは順番待ちの列に積んで非同期に流す。失敗しても画面は止めない

export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
export const DEFAULT_GENERATIONS = 6; // 退避したファイルを残す数（月ごとなら半年分）
export const CURRENT_FILE_NAME = "access.log";

// 退避後の名前（access-20260921-123456-01.log）。通番を必ず付けるのは、
// 同じ秒に重なっても「名前の順＝古い順」になるようにするため（prune がこの順に消す）
const ROTATED_PATTERN = /^access-\d{8}-\d{6}-\d{2,}\.log$/;

export type AccessLogSink = {
  write(line: string): void;
  // 溜まっている分を書き終えるまで待つ（テストと終了時に使う）
  flush(): Promise<void>;
};

export type FileSinkOptions = {
  dir: string;
  maxBytes?: number;
  generations?: number;
};

// 日本時間の「年-月」。月が変わったかの判定に使う
function monthKeyTokyo(at: Date): string {
  return formatTimestampTokyo(at).slice(0, 7); // "2026-09"
}

// 日本時間の「YYYYMMDD-HHMMSS」。退避したファイルの名前に使う
function stamp(at: Date): string {
  const ts = formatTimestampTokyo(at); // "2026-09-21T12:34:56.789+09:00"
  return `${ts.slice(0, 10).replaceAll("-", "")}-${ts.slice(11, 19).replaceAll(":", "")}`;
}

// 退避するか。日本時間の月が変わったか、上限の大きさを超えたら退避する。空のファイルは退避しない
export function needsRotation(info: { size: number; mtime: Date }, now: Date, maxBytes: number): boolean {
  if (info.size === 0) return false;
  if (info.size >= maxBytes) return true;
  return monthKeyTokyo(info.mtime) !== monthKeyTokyo(now);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 空いている退避先の名前を決める
export async function rotatedName(dir: string, now: Date): Promise<string> {
  const base = `access-${stamp(now)}`;
  for (let i = 1; ; i += 1) {
    const name = `${base}-${String(i).padStart(2, "0")}.log`;
    if (!(await exists(join(dir, name)))) return name;
  }
}

// 古い退避ファイルを消して、残す数を generations に収める。名前が時刻の順なので名前で並べ替える
export async function prune(dir: string, generations: number): Promise<string[]> {
  const rotated = (await readdir(dir)).filter((name) => ROTATED_PATTERN.test(name)).sort();
  const removed = rotated.slice(0, Math.max(0, rotated.length - generations));
  for (const name of removed) await unlink(join(dir, name));
  return removed;
}

export async function rotateIfNeeded(options: Required<FileSinkOptions>, now: Date): Promise<boolean> {
  const current = join(options.dir, CURRENT_FILE_NAME);
  const info = await stat(current).catch(() => null);
  if (!info || !needsRotation({ size: info.size, mtime: info.mtime }, now, options.maxBytes)) return false;
  await rename(current, join(options.dir, await rotatedName(options.dir, now)));
  await prune(options.dir, options.generations);
  return true;
}

export function createFileSink(options: FileSinkOptions): AccessLogSink {
  const settings: Required<FileSinkOptions> = {
    dir: options.dir,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    generations: options.generations ?? DEFAULT_GENERATIONS,
  };
  let pending: string[] = [];
  let running: Promise<void> = Promise.resolve();
  let warned = false;

  async function flushPending(): Promise<void> {
    if (pending.length === 0) return;
    const chunk = pending.join("");
    pending = [];
    try {
      await mkdir(settings.dir, { recursive: true });
      await rotateIfNeeded(settings, new Date());
      await appendFile(join(settings.dir, CURRENT_FILE_NAME), chunk, "utf8");
    } catch (error) {
      // ログを書けないだけで画面を止めない。うるさくならないよう最初の 1 回だけ知らせる
      if (!warned) {
        warned = true;
        console.error(`操作ログを書けませんでした（${settings.dir}）:`, error instanceof Error ? error.message : error);
      }
    }
  }

  return {
    write(line: string): void {
      pending.push(line);
      running = running.then(flushPending);
    },
    flush(): Promise<void> {
      return running;
    },
  };
}

export function createStdoutSink(): AccessLogSink {
  return {
    write(line: string): void {
      process.stdout.write(line);
    },
    flush(): Promise<void> {
      return Promise.resolve();
    },
  };
}
