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
      <Button variant="secondary" className="min-h-10 self-start" onClick={mark} pending={pending} pendingLabel="記録しています…">
        確認済みにする
      </Button>
      {failure ? <p className="text-sm font-semibold text-danger">{failure}</p> : null}
    </div>
  );
}
