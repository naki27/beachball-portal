"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

// 協会に「切り替えて入る」「出る」（§5.14「運営管理者」）
export function EnterTenantControls({ associationId, slug, entered }: { associationId: string; slug: string; entered: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/associations/${associationId}/enter`, { method });
      if (!response.ok) setError("切り替えられませんでした");
      router.refresh();
    } catch {
      setError("切り替えられませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-hydrated={hydrated || undefined}>
      {error ? <Message kind="error" title={error} /> : null}
      {entered ? (
        <>
          <Message kind="info" title="運営管理者としてこの協会に入っています" />
          <Link href={`/${slug}/admin`} className={buttonClass("primary", true)}>
            この協会の管理画面を開く
          </Link>
          <Button variant="secondary" onClick={() => call("DELETE")} pending={pending} pendingLabel="出ています…" fullWidth>
            この協会から出る
          </Button>
        </>
      ) : (
        <Button onClick={() => call("POST")} pending={pending} pendingLabel="入っています…" fullWidth>
          この協会に切り替えて入る
        </Button>
      )}
    </div>
  );
}
