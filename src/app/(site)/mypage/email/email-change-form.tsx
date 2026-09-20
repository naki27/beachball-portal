"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { normalizeCodeInput } from "@/lib/auth/login-input";

// 2 段階: ①新しいアドレスを入れて確認番号を送る ②番号を入れて確定（§5.19）
type Step = "email" | "code";

export function EmailChangeForm() {
  const hydrated = useHydrated();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; title: string; body?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFieldError(null);
    setNotice(null);
    setPending(true);
    try {
      const response = await fetch("/api/me/email/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setFieldError(body?.error?.message ?? "送信できませんでした");
        return;
      }
      setStep("code");
      setNotice({ kind: "info", title: "確認番号を送りました", body: "新しいメールアドレスに届いた 6 けたの数字を入れてください。" });
    } finally {
      setPending(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const digits = normalizeCodeInput(code);
    setFieldError(null);
    setNotice(null);
    setPending(true);
    try {
      const response = await fetch("/api/me/email/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: digits }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; email?: string; error?: { message?: string; remaining?: number } }
        | null;
      if (!response.ok || !body?.ok) {
        const remaining = body?.error?.remaining;
        setFieldError(
          typeof remaining === "number" && remaining > 0
            ? `${body?.error?.message ?? "番号が違います"}。メールに書かれた 6 けたの数字を入れてください（あと ${remaining} 回）`
            : (body?.error?.message ?? "番号が違います"),
        );
        return;
      }
      setDone(body.email ?? email);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Message kind="success" title="メールアドレスを変更しました">
        <p className="break-all">
          これからは <span className="font-semibold">{done}</span> に確認番号が届きます。古いメールアドレスには、変更したことをお知らせしました。
        </p>
        <p>ほかの端末でログインしていた場合は、ログインし直してください。</p>
      </Message>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={confirm} data-hydrated={hydrated ? "" : undefined} className="flex flex-col gap-5">
        {notice ? <Message kind={notice.kind} title={notice.title}>{notice.body ? <p>{notice.body}</p> : null}</Message> : null}
        <TextField
          id="code"
          label="確認番号（6 けた）"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={20}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={fieldError}
          hint={<span className="break-all">送り先: {email}</span>}
        />
        <Button type="submit" pending={pending} fullWidth pendingLabel="確かめています…">
          メールアドレスを変更する
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setStep("email");
            setCode("");
            setFieldError(null);
            setNotice(null);
          }}
        >
          メールアドレスを入れ直す
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} data-hydrated={hydrated ? "" : undefined} className="flex flex-col gap-5">
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      <TextField
        id="email"
        label="新しいメールアドレス"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldError}
        hint="ご自分で受け取れるメールアドレスを入れてください"
      />
      <Button type="submit" pending={pending} fullWidth pendingLabel="送っています…">
        確認番号を送る
      </Button>
    </form>
  );
}
