"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

// アカウントと人物の紐づけの解除（本人・§5.15）。押すと確認を挟み、解除すると選手としての閲覧ができなくなる
export function UnlinkButton({ slug, memberId, personName }: { slug: string; memberId: string; personName: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlink() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/${slug}/members/${memberId}/link`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "解除できませんでした");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("解除できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-hydrated={hydrated || undefined}>
      {error ? <Message kind="error" title={error} /> : null}
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3">
          <p className="text-sm">
            {personName}さんの登録とこのアカウントの結びつきを解除します。解除すると、チームの選手一覧や申し込みを見られなくなります（名簿の登録は残ります）。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" className="min-h-10" onClick={unlink} pending={pending} pendingLabel="解除しています…">
              解除する
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={() => setConfirming(false)} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="self-start text-sm underline underline-offset-2">
          アカウントとの結びつきを解除する
        </button>
      )}
    </div>
  );
}
