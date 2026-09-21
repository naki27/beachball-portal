"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 「運営の確認対象」の印を外す（設計書 §5.5）。押すと一覧を読み直す
export function CheckedButton({ slug, entryId }: { slug: string; entryId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function mark() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/admin/entries/${entryId}/checked`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setFailure(body?.error?.message ?? "変えられませんでした");
        return;
      }
      router.refresh();
    } catch {
      setFailure("変えられませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" size="sm" className="self-start" onClick={mark} pending={pending} pendingLabel="記録しています…">
        確認済みにする
      </Button>
      {failure ? <p className="text-sm font-semibold text-danger">{failure}</p> : null}
    </div>
  );
}

// 誤登録の申込を削除する（論理削除・§5.16）。取消（代表者の操作）とは別物で、削除済みデータから元に戻せる
export function DeleteEntryButton({ slug, entryId }: { slug: string; entryId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/admin/entries/${entryId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setFailure(body?.error?.message ?? "削除できませんでした");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setFailure("削除できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {failure ? <p className="text-sm font-semibold text-danger">{failure}</p> : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">誤登録として削除します（削除済みデータから元に戻せます）</span>
          <Button variant="danger" size="sm" onClick={remove} pending={pending} pendingLabel="削除しています…">
            削除する
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
            やめる
          </Button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="min-h-11 self-start px-1 text-sm underline underline-offset-2">
          誤登録として削除する
        </button>
      )}
    </div>
  );
}
