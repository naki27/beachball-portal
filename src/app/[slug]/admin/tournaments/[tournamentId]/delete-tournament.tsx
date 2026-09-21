"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

// 大会の削除（論理削除・設計書 §5.16）。完全に削除するのは /admin/trash から
export function DeleteTournament({ slug, tournamentId, entryCount }: { slug: string; tournamentId: string; entryCount: number }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/admin/tournaments/${tournamentId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setFailure(body?.error?.message ?? "削除できませんでした");
        return;
      }
      router.push(`/${slug}/admin/tournaments`);
      router.refresh();
    } catch {
      setFailure("削除できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="delete-tournament" data-hydrated={hydrated || undefined} className="flex flex-col gap-2">
      <h2 id="delete-tournament" className="text-lg font-bold">
        大会の削除
      </h2>
      {failure ? <Message kind="error" title={failure} /> : null}
      {confirming ? (
        <div className="bb-slide-in flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3">
          <p className="text-sm">
            削除すると、この大会と{entryCount > 0 ? `${entryCount} 件の申し込みが` : "部が"}公開ページ・一覧から見えなくなります。
            「削除済みデータ」から元に戻せます。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="sm" onClick={remove} pending={pending} pendingLabel="削除しています…">
              削除する
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" className="self-start" onClick={() => setConfirming(true)}>
          この大会を削除する
        </Button>
      )}
    </section>
  );
}
