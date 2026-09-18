"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 運営管理者が協会に「切り替えて入っている」間、画面上部に出す帯（§5.14）。「出る」で即座に解除
export function EnteredBanner({ associationId, associationName }: { associationId: string; associationName: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function leave() {
    if (pending) return;
    setPending(true);
    try {
      await fetch(`/api/platform/associations/${associationId}/enter`, { method: "DELETE" });
    } finally {
      setPending(false);
      router.refresh();
    }
  }

  return (
    <div role="status" className="bg-warning px-4 py-2 text-on-primary">
      <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
        <span className="text-sm font-semibold">運営管理者として {associationName} を表示中</span>
        <button
          type="button"
          onClick={leave}
          disabled={pending}
          className="bb-pressable min-h-10 shrink-0 rounded-md border border-on-primary/70 px-3 text-sm font-semibold disabled:opacity-60"
        >
          {pending ? "出ています…" : "出る"}
        </button>
      </div>
    </div>
  );
}
