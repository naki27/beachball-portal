"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

// 申込の取消（設計書 §5.5(d)）。取り消すと元に戻せないので、確認を挟む
export function EntryCancel({ slug, entryId }: { slug: string; entryId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function cancel() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/entries/${entryId}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setFailure(body?.error?.message ?? "取り消せませんでした");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setFailure("取り消せませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-2">
      {failure ? <Message kind="error" title={failure} /> : null}
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3">
          <p className="text-sm">取り消すと元に戻せません。もう一度出る場合は申し込み直してください。</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" className="min-h-10" onClick={cancel} pending={pending} pendingLabel="取り消しています…">
              申し込みを取り消す
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={() => setConfirming(false)} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setConfirming(true)}>
          この申し込みを取り消す
        </Button>
      )}
    </div>
  );
}
