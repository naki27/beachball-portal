"use client";

import { useSyncExternalStore } from "react";

// ログイン画面（/login → /login/code → /login/help）で共有する、ブラウザ側の小さな状態
// メールアプリを見に行った間にタブが再読み込みされても続きから始められるように、sessionStorage に持つ（§9.2）
// sessionStorage は React の外にあるので useSyncExternalStore で読む（render の中で直接読まない）

const KEY_EMAIL = "login:email";
const KEY_NEXT = "login:next";
const KEY_RESEND_AT = "login:resendAt";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
function notify(): void {
  listeners.forEach((cb) => cb());
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const nullSnapshot = () => null;
const readEmail = () => storage()?.getItem(KEY_EMAIL) ?? null;
const readNext = () => storage()?.getItem(KEY_NEXT) ?? null;
const readResendAt = () => storage()?.getItem(KEY_RESEND_AT) ?? null;

export function rememberLogin(email: string, next: string | null, resendAfterSeconds: number): void {
  const s = storage();
  if (!s) return;
  s.setItem(KEY_EMAIL, email);
  if (next) s.setItem(KEY_NEXT, next);
  else s.removeItem(KEY_NEXT);
  s.setItem(KEY_RESEND_AT, String(Date.now() + resendAfterSeconds * 1000));
  notify();
}

export function forgetLogin(): void {
  const s = storage();
  if (!s) return;
  s.removeItem(KEY_EMAIL);
  s.removeItem(KEY_NEXT);
  s.removeItem(KEY_RESEND_AT);
  notify();
}

export function rememberedNext(): string | null {
  return readNext();
}

// サーバーでは null（描画のあとにブラウザで読む）
export function useRememberedEmail(): string | null {
  return useSyncExternalStore(subscribe, readEmail, nullSnapshot);
}

export function useRememberedNext(): string | null {
  return useSyncExternalStore(subscribe, readNext, nullSnapshot);
}

// 「もう一度送る」を押せるようになる時刻（ミリ秒）。なければ null
export function useResendAvailableAt(): number | null {
  const raw = useSyncExternalStore(subscribe, readResendAt, nullSnapshot);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

// 1 秒ごとに進む今の時刻（「あと 25 秒で送れます」用）。サーバーでは 0
// getSnapshot は同じ値を返し続けないといけない（毎回 Date.now() を返すと、React が「変わった」と見なして再描画が止まらない）
// ので、tick のときだけ値を進める
let nowSnapshot = 0;
function subscribeTick(cb: () => void): () => void {
  nowSnapshot = Date.now();
  const id = setInterval(() => {
    nowSnapshot = Date.now();
    cb();
  }, 1000);
  return () => clearInterval(id);
}
const getNow = () => nowSnapshot || (nowSnapshot = Date.now());
const getServerNow = () => 0;
export function useNow(): number {
  return useSyncExternalStore(subscribeTick, getNow, getServerNow);
}

// クライアントで描画しているか（sessionStorage を読めるか）
export { useHydrated as useIsClient } from "@/hooks/use-hydrated";

export type RequestCodeOutcome =
  | { kind: "sent"; resendAfterSeconds: number }
  | { kind: "invalid"; message: string }
  | { kind: "rate_limited"; retryAt: Date }
  | { kind: "error" };

// POST /api/auth/request を呼ぶ（画面 3 つで共通）
export async function requestCode(email: string, next: string | null): Promise<RequestCodeOutcome> {
  try {
    const response = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, next }),
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; resendAfterSeconds?: number; error?: { message?: string; retryAt?: string } }
      | null;
    if (response.ok && body?.ok) return { kind: "sent", resendAfterSeconds: body.resendAfterSeconds ?? 30 };
    if (response.status === 400) return { kind: "invalid", message: body?.error?.message ?? "メールアドレスの形で入力してください" };
    if (response.status === 429 && body?.error?.retryAt) return { kind: "rate_limited", retryAt: new Date(body.error.retryAt) };
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

// 「◯時◯分まで送れません」の時刻（日本時間）
export function formatRetryAt(retryAt: Date): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "numeric", minute: "2-digit" }).format(retryAt);
}

// 戻り先として受け付けるのは、同じサイト内の相対パスだけ（/ で始まり // で始まらない・§5.2）
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
