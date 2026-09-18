"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { formatRetryAt, rememberLogin, requestCode, useIsClient } from "@/lib/auth/login-client";

// メールアドレスの入力 → POST /api/auth/request → /login/code へ
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const hydrated = useIsClient(); // E2E がハイドレーション後に押すための印（data-hydrated）
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; title: string; body?: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFieldError(null);
    setNotice(null);
    if (!email.includes("@")) {
      setFieldError("メールアドレスの形で入力してください");
      return;
    }
    setPending(true);
    const outcome = await requestCode(email.trim(), next);
    setPending(false);
    switch (outcome.kind) {
      case "sent":
        rememberLogin(email.trim(), next, outcome.resendAfterSeconds);
        router.push(next ? `/login/code?next=${encodeURIComponent(next)}` : "/login/code");
        return;
      case "invalid":
        setFieldError(outcome.message);
        return;
      case "rate_limited":
        setNotice({
          kind: "info",
          title: `${formatRetryAt(outcome.retryAt)}まで送れません。迷惑メールフォルダも見てください`,
        });
        return;
      case "error":
        setNotice({ kind: "error", title: "送信できませんでした", body: "時間をおいてから、もう一度お試しください。" });
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate data-hydrated={hydrated || undefined} className="flex flex-col gap-5">
      {notice ? (
        <Message kind={notice.kind} title={notice.title}>
          {notice.body ? <p>{notice.body}</p> : null}
          {notice.kind === "info" ? (
            <p>
              <Link href="/login/help" className="underline underline-offset-2">
                メールが届かないとき
              </Link>
            </p>
          ) : null}
        </Message>
      ) : null}
      <TextField
        id="email"
        label="メールアドレス"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoFocus
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldError}
        hint={
          <>
            ログインすると、
            <Link href="/terms" className="underline underline-offset-2">
              利用規約
            </Link>
            と
            <Link href="/privacy" className="underline underline-offset-2">
              プライバシーポリシー
            </Link>
            に同意したものとします。
          </>
        }
      />
      <Button type="submit" pending={pending} fullWidth>
        確認番号を送る
      </Button>
    </form>
  );
}
