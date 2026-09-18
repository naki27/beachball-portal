"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import {
  formatRetryAt,
  rememberLogin,
  requestCode,
  safeNext,
  useIsClient,
  useNow,
  useRememberedEmail,
  useRememberedNext,
  useResendAvailableAt,
} from "@/lib/auth/login-client";
import { normalizeCodeInput } from "@/lib/auth/login-input";

// 6 桁の入力欄は 1 つ（貼り付け・自動入力で崩れないように）。inputmode="numeric" autocomplete="one-time-code"
// 6 桁を入れ終わったら自動で照合する（「ログイン」ボタンも残す）。間違えたら番号を消さずに全選択にする（§4.5）
// 照合の API（POST /api/auth/verify）は A-09

type Notice = { kind: "success" | "error" | "info"; title: string; body?: string };

export function CodeForm({ next }: { next: string | null }) {
  const isClient = useIsClient();
  const email = useRememberedEmail();
  const rememberedNext = useRememberedNext();
  const nextPath = safeNext(next) ?? safeNext(rememberedNext);
  const now = useNow();
  const resendAvailableAt = useResendAvailableAt();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sentCount, setSentCount] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef<string | null>(null);

  const waitSeconds = resendAvailableAt ? Math.max(0, Math.ceil((resendAvailableAt - now) / 1000)) : 0;

  const verify = useCallback(
    async (digits: string) => {
      setPending(true);
      setFieldError(null);
      try {
        const response = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: digits, next: nextPath }),
        });
        const body = (await response.json().catch(() => null)) as
          | { ok?: boolean; redirectTo?: string; error?: { message?: string; remaining?: number } }
          | null;
        if (response.ok && body?.ok) {
          setNotice({ kind: "success", title: "ログインしました" });
          window.location.assign(body.redirectTo ?? "/");
          return;
        }
        if (response.status === 409) {
          setNotice({
            kind: "info",
            title: "別の端末（またはアプリ）でログインしています。そちらでログアウトしてから、もう一度お試しください",
          });
          return;
        }
        const remaining = body?.error?.remaining;
        if (remaining === 0) {
          setFieldError("番号を間違えた回数が上限に達しました。もう一度メールを送ってください");
        } else {
          setFieldError(
            `番号が違います。メールに書かれた 6 けたの数字を入れてください${remaining !== undefined ? `（あと${remaining}回）` : ""}`,
          );
        }
        // 入力した番号は消さずに全選択（見比べて直せる。打ち直すと置き換わる）
        requestAnimationFrame(() => inputRef.current?.select());
      } catch {
        setNotice({ kind: "error", title: "確認できませんでした", body: "電波の状態を確かめて、もう一度お試しください。" });
      } finally {
        setPending(false);
      }
    },
    [nextPath],
  );

  // 6 桁を入れ終わったら自動で照合（同じ値で二度は送らない）
  useEffect(() => {
    const digits = normalizeCodeInput(code);
    if (!digits || submittedRef.current === digits) return;
    submittedRef.current = digits;
    void verify(digits);
  }, [code, verify]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const digits = normalizeCodeInput(code);
    if (!digits) {
      setFieldError("メールに書かれた 6 けたの数字を入れてください");
      inputRef.current?.focus();
      return;
    }
    submittedRef.current = digits;
    await verify(digits);
  }

  async function resend() {
    if (!email || resending) return;
    setResending(true);
    setNotice(null);
    const outcome = await requestCode(email, nextPath);
    setResending(false);
    if (outcome.kind === "sent") {
      rememberLogin(email, nextPath, outcome.resendAfterSeconds);
      setSentCount((n) => n + 1);
      setNotice({ kind: "success", title: "もう一度メールを送りました", body: "届いたメールのどの番号でも使えます。" });
    } else if (outcome.kind === "rate_limited") {
      setNotice({ kind: "info", title: `${formatRetryAt(outcome.retryAt)}まで送れません。迷惑メールフォルダも見てください` });
    } else {
      setNotice({ kind: "error", title: "送信できませんでした", body: "時間をおいてから、もう一度お試しください。" });
    }
  }

  if (isClient && !email) {
    return (
      <div className="flex flex-col gap-4">
        <p className="leading-relaxed">メールアドレスの入力からやり直してください。</p>
        <Link
          href={nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login"}
          className="inline-flex min-h-10 items-center underline underline-offset-2"
        >
          ログインの画面へ
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <p className="bb-slide-in flex items-start gap-2 leading-relaxed">
        <span aria-hidden="true" className="text-xl">
          ✉️
        </span>
        <span>
          <span className="font-semibold">{email ?? ""}</span> にメールを送りました。届いた 6 けたの数字を入れてください。
          {sentCount > 1 ? " 届いたメールのどの番号でも使えます。" : ""}
        </span>
      </p>
      {notice ? (
        <Message kind={notice.kind} title={notice.title}>
          {notice.body ? <p>{notice.body}</p> : null}
        </Message>
      ) : null}
      <TextField
        ref={inputRef}
        id="code"
        label="確認番号（6 けた）"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        autoFocus
        maxLength={12}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={fieldError}
        className="text-2xl tracking-[0.3em]"
      />
      <Button type="submit" pending={pending} pendingLabel="確認しています…" fullWidth>
        ログイン
      </Button>
      {isClient ? (
        <div className="flex flex-col gap-2 text-sm">
          {waitSeconds > 0 ? (
            <p className="text-muted" role="status">
              あと {waitSeconds} 秒で、もう一度送れます
            </p>
          ) : (
            <Button type="button" variant="secondary" onClick={resend} pending={resending} pendingLabel="送っています…">
              もう一度送る
            </Button>
          )}
          <Link href="/login/help" className="inline-flex min-h-10 items-center underline underline-offset-2">
            メールが届かないとき
          </Link>
        </div>
      ) : null}
    </form>
  );
}
