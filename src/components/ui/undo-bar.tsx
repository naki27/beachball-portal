"use client";

import type { ReactNode } from "react";

// 「外しました［元に戻す］」「削除しました［元に戻す］」の帯（§4.5）
// ［元に戻す］は直前の操作の取り消し専用で、その操作をした本人だけが押せる。押せない人には onUndo を渡さない（ボタンを出さない）
export function UndoBar({
  message,
  onUndo,
  undoLabel = "元に戻す",
  pending = false,
}: {
  message: ReactNode;
  onUndo?: () => void;
  undoLabel?: string;
  pending?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="bb-slide-in flex min-h-12 items-center justify-between gap-3 rounded-md bg-foreground px-4 py-2 text-background"
    >
      <span className="font-semibold">{message}</span>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={pending}
          className="bb-pressable min-h-10 shrink-0 rounded-md border border-background/60 px-3 font-semibold underline-offset-2 disabled:opacity-60"
        >
          {pending ? "戻しています…" : undoLabel}
        </button>
      ) : null}
    </div>
  );
}
