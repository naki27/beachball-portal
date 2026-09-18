"use client";

import { useEffect, useState } from "react";

// 読み込みの骨組み（§4.5）: 1 秒を超えたら内容の形をした薄い骨組み、3 秒を超えたら「少々お待ちください」
// 1 秒未満で終わる読み込みでは何も出さない（画面がちらつかないように）
export function DelayedSkeleton({
  lines = 4,
  skeletonAfterMs = 1000,
  messageAfterMs = 3000,
  label = "読み込んでいます",
}: {
  lines?: number;
  skeletonAfterMs?: number;
  messageAfterMs?: number;
  label?: string;
}) {
  const [phase, setPhase] = useState<"quiet" | "skeleton" | "message">("quiet");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("skeleton"), skeletonAfterMs);
    const t2 = setTimeout(() => setPhase("message"), messageAfterMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [skeletonAfterMs, messageAfterMs]);

  return (
    <div role="status" aria-live="polite" aria-label={label} className="flex flex-col gap-3">
      {phase !== "quiet" ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div
              key={i}
              className="h-5 rounded bg-surface"
              style={{ width: `${[92, 70, 84, 55][i % 4]}%` }}
            />
          ))}
        </div>
      ) : null}
      {phase === "message" ? <p className="font-semibold text-muted">少々お待ちください</p> : null}
    </div>
  );
}

// 内容の形をした骨組みだけ（loading.tsx などで、遅延なしに使う）
export function Skeleton({ className = "h-5 w-full" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded bg-surface ${className}`} />;
}
