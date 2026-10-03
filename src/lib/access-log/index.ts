import type { NextRequest } from "next/server";
import { sessionCookieName } from "@/lib/auth/cookies";
import { buildRecord, formatLine, type RequestFacts, shouldSkipPath } from "./line";
import { type AccessLogSink, createFileSink, createStdoutSink } from "./sink";

// 利用者の操作ログ（docs/adr/0027）。proxy.ts から 1 リクエストに 1 回呼ぶ
// 呼ぶ側は出力先の違いを知らない（STORAGE_DRIVER と同じ形）

export type AccessLogDriver = "file" | "stdout" | "off";

export const DEFAULT_LOG_DIR = "logs";

export function accessLogDriver(): AccessLogDriver {
  const value = (process.env.ACCESS_LOG_DRIVER ?? "file").trim();
  if (value === "off" || value === "stdout") return value;
  return "file";
}

function numberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function createSink(driver: AccessLogDriver = accessLogDriver()): AccessLogSink | null {
  if (driver === "off") return null;
  if (driver === "stdout") return createStdoutSink();
  return createFileSink({
    dir: process.env.ACCESS_LOG_DIR ?? DEFAULT_LOG_DIR,
    maxBytes: numberFromEnv("ACCESS_LOG_MAX_BYTES"),
    generations: numberFromEnv("ACCESS_LOG_GENERATIONS"),
  });
}

let sink: AccessLogSink | null | undefined;

function getSink(): AccessLogSink | null {
  if (sink === undefined) sink = createSink();
  return sink;
}

// 接続元の IP。Cloud Run と Cloudflare は x-forwarded-for の先頭に本来の送信元を入れる
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}

export function factsFrom(request: NextRequest, now: Date = new Date()): RequestFacts {
  return {
    at: now,
    method: request.method,
    path: request.nextUrl.pathname,
    search: request.nextUrl.search,
    sessionId: request.cookies.get(sessionCookieName())?.value ?? null,
    // Server Action の id。どの画面の「どの操作」かの手がかりになる（POST は画面と同じ URL のため）
    actionId: request.headers.get("next-action"),
    ip: clientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
  };
}

export function recordRequest(request: NextRequest, now: Date = new Date()): void {
  const target = getSink();
  if (!target) return;
  if (shouldSkipPath(request.nextUrl.pathname)) return;
  target.write(formatLine(buildRecord(factsFrom(request, now))));
}

export type { AccessLogRecord, RequestFacts } from "./line";
export type { AccessLogSink } from "./sink";
