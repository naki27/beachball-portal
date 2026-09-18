import type { ReactNode } from "react";
import { CheckIcon } from "./check-icon";

export type MessageKind = "success" | "error" | "info";

const KIND_CLASS: Record<MessageKind, string> = {
  success: "border-success bg-success-surface text-success",
  error: "border-danger bg-danger-surface text-danger",
  info: "border-border bg-info-surface text-foreground",
};

// 成功・エラー・案内のメッセージ（§4.5 原則 4・6）。自動で消えない（次の操作かページを離れるまで残す）。読み上げ対象
// 成功は緑のチェックが描かれる。動きを見逃しても文字で分かる
export function Message({
  kind,
  title,
  children,
  className = "",
}: {
  kind: MessageKind;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={`bb-slide-in flex gap-3 rounded-md border px-4 py-3 ${KIND_CLASS[kind]} ${className}`}
    >
      {kind === "success" ? <CheckIcon className="mt-0.5 size-6 shrink-0" /> : null}
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        {children ? <div className="text-sm text-foreground">{children}</div> : null}
      </div>
    </div>
  );
}
