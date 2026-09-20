"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { normalizeCodeInput } from "@/lib/auth/login-input";

// 確認番号をいまのメールアドレスに送り、入れ直してから削除する（§5.19）
export function DeleteAccountForm({ email }: { email: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; title: string; body?: string } | null>(null);

  async function sendCode() {
    if (pending) return;
    setPending(true);
    setNotice(null);
    setFieldError(null);
    try {
      const response = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setNotice({ kind: "error", title: body?.error?.message ?? "確認番号を送れませんでした" });
        return;
      }
      setSent(true);
      setNotice({ kind: "info", title: "確認番号を送りました", body: `${email} に届いた 6 けたの数字を入れてください。` });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (pending) return;
    setPending(true);
    setFieldError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/me", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: normalizeCodeInput(code) }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: { message?: string; remaining?: number } }
        | null;
      if (!response.ok || !body?.ok) {
        const remaining = body?.error?.remaining;
        if (response.status === 409) {
          setNotice({ kind: "error", title: body?.error?.message ?? "このアカウントは削除できません" });
          return;
        }
        setFieldError(
          typeof remaining === "number" && remaining > 0
            ? `番号が違います。メールに書かれた 6 けたの数字を入れてください（あと ${remaining} 回）`
            : (body?.error?.message ?? "番号が違います"),
        );
        return;
      }
      // セッションは消えているので、ログインの入口に戻す（サーバー側の描画も取り直す）
      router.push("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-hydrated={hydrated ? "" : undefined} className="flex flex-col gap-5">
      {notice ? (
        <Message kind={notice.kind} title={notice.title}>
          {notice.body ? <p>{notice.body}</p> : null}
        </Message>
      ) : null}
      {sent ? (
        <>
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
          <Button type="button" variant="danger" pending={pending} fullWidth pendingLabel="削除しています…" onClick={remove}>
            アカウントを削除する
          </Button>
        </>
      ) : (
        <Button type="button" variant="danger" pending={pending} fullWidth pendingLabel="送っています…" onClick={sendCode}>
          確認番号を送る
        </Button>
      )}
    </div>
  );
}
