"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

// チームの無効化・有効に戻す（設計書 §5.11「チームの無効化と削除」）。代表者とテナント管理者
// 無効にする前に確認を挟む。削除（論理削除）はテナント管理者だけなので、ここにはない（解散は問い合わせフォームで協会に連絡）
export function TeamStatusControls({ slug, teamId, status }: { slug: string; teamId: string; status: "active" | "inactive" }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; title: string } | null>(null);

  async function change(next: "active" | "inactive") {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${slug}/teams/${teamId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setNotice({ kind: "error", title: body?.error?.message ?? "変えられませんでした" });
        return;
      }
      setConfirming(false);
      setNotice({ kind: "success", title: next === "inactive" ? "チームを無効にしました" : "チームを有効に戻しました" });
      router.refresh();
    } catch {
      setNotice({ kind: "error", title: "変えられませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="team-status" className="flex flex-col gap-3" data-hydrated={hydrated || undefined}>
      <h2 id="team-status" className="text-lg font-bold">
        チームの状態
      </h2>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      {status === "active" ? (
        confirming ? (
          <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3">
            <p className="text-sm">
              無効にすると、大会に申し込めなくなり、返事待ちの招待は取り消されます。選手一覧と代表者はそのまま残り、いつでも有効に戻せます。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" className="min-h-10" onClick={() => change("inactive")} pending={pending} pendingLabel="無効にしています…">
                無効にする
              </Button>
              <Button variant="secondary" className="min-h-10" onClick={() => setConfirming(false)} disabled={pending}>
                やめる
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">活動をやめるときは無効にできます。チームを解散して消したいときは、協会にお問い合わせください。</p>
            <Button variant="secondary" className="self-start" onClick={() => setConfirming(true)}>
              このチームを無効にする
            </Button>
          </div>
        )
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => change("active")} pending={pending} pendingLabel="戻しています…">
          有効に戻す
        </Button>
      )}
    </section>
  );
}
