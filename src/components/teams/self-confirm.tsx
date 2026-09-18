"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";
import { parsePlainDate } from "@/lib/date";
import { SEX_LABEL } from "@/lib/teams/player-input";
import type { MyPerson } from "@/lib/teams/self";
import { formatBirthDateLong } from "@/lib/wareki";

// すでに自分のアカウントに紐づいた人物があるとき（§5.11「個人登録」v0.9）。氏名などの入力は省き、確認だけにする
export function SelfConfirm({
  person,
  url,
  body,
  successPath,
  label,
}: {
  person: MyPerson;
  url: string;
  body: Record<string, unknown>;
  successPath: string;
  label: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const birth = parsePlainDate(person.birthDate);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => null)) as { redirectTo?: string; error?: { message?: string } } | null;
      if (!response.ok) {
        setNotice(data?.error?.message ?? "登録できませんでした");
        return;
      }
      router.push(data?.redirectTo ?? successPath);
      router.refresh();
    } catch {
      setNotice("登録できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind="error" title={notice} /> : null}
      <div className="flex flex-col gap-1 rounded-md border border-border px-4 py-3">
        <p className="text-sm text-muted">あなたの登録情報</p>
        <p className="text-lg font-semibold">{person.name}</p>
        {person.kana ? <p className="text-sm text-muted">{person.kana}</p> : null}
        {birth ? (
          <p className="text-sm">
            {formatBirthDateLong(birth)}・{person.age}歳・{SEX_LABEL[person.sex]}
          </p>
        ) : null}
      </div>
      <Button onClick={confirm} pending={pending} pendingLabel="登録しています…" fullWidth>
        {label}
      </Button>
    </div>
  );
}
