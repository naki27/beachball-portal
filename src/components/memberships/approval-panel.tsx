"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

// 申告の一括承認（設計書 §5.12「運営が一括承認して approved」）。押すと承認して一覧を読み直す
type ApiBody = { result?: { approved: number; teams: number }; error?: { message?: string } };

export function ApprovalPanel({
  slug,
  year,
  scope,
  teamIds,
  count,
  label,
}: {
  slug: string;
  year: number;
  scope: "renewal" | "additional";
  teamIds?: string[];
  count: number;
  label: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function approve() {
    if (pending) return;
    setPending(true);
    setDone(null);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/admin/memberships/${year}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(teamIds ? { scope, teamIds } : { scope }),
      });
      const body = (await response.json().catch(() => null)) as ApiBody | null;
      if (!response.ok) {
        setFailure(body?.error?.message ?? "承認できませんでした");
        return;
      }
      setDone(`${body?.result?.approved ?? 0} 人を承認しました（代表者にお知らせのメールを送ります）`);
      router.refresh();
    } catch {
      setFailure("承認できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-2">
      {done ? <Message kind="success" title={done} /> : null}
      {failure ? <Message kind="error" title={failure} /> : null}
      <Button className="self-start" onClick={approve} pending={pending} pendingLabel="承認しています…" disabled={count === 0}>
        {label}
      </Button>
    </div>
  );
}
