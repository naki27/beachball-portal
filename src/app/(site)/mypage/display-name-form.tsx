"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { DISPLAY_NAME_MAX, parseDisplayName } from "@/lib/account/display-name";

// 表示名の変更（任意・§5.3）。空にすると表示名なし
export function DisplayNameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; title: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setNotice(null);
    const parsed = parseDisplayName(value);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: parsed.value }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "変更できませんでした");
        return;
      }
      setValue(parsed.value ?? "");
      setNotice({ kind: "success", title: parsed.value ? "表示名を変更しました" : "表示名を消しました" });
      router.refresh();
    } catch {
      setNotice({ kind: "error", title: "変更できませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      <TextField
        id="display-name"
        label="表示名（任意）"
        hint={`招待のメールなどで、あなたの名前として出ます。${DISPLAY_NAME_MAX}文字まで`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="nickname"
        maxLength={DISPLAY_NAME_MAX * 2}
        error={error}
      />
      <div>
        <Button type="submit" variant="secondary" pending={pending} pendingLabel="変更しています…">
          表示名を変更する
        </Button>
      </div>
    </form>
  );
}
