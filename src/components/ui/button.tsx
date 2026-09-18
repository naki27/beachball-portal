import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary active:bg-primary-strong",
  secondary: "border border-border bg-background text-foreground active:bg-surface",
  danger: "border border-danger bg-background text-danger active:bg-danger-surface",
};

// ボタン（§4.5「共通」）。押した瞬間に色が濃くなり沈む。送信中は文字が「送信しています…」になり押せなくなる（二度押しを防ぐ）
// 高さ 48px 以上（指で押しやすい大きさ・§4.3）。主要操作の画面下部への固定は、使う画面の側で行う
export function Button({
  variant = "primary",
  pending = false,
  pendingLabel = "送信しています…",
  fullWidth = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  // 送信中。true の間は押せない
  pending?: boolean;
  pendingLabel?: string;
  fullWidth?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`bb-pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-center text-base font-semibold disabled:opacity-60 ${VARIANT_CLASS[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {pending ? (
        <>
          <Spinner />
          <span>{pendingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

// リンクをボタンの見た目にするときの class（next/link と組み合わせる）
export function buttonClass(variant: ButtonVariant = "primary", fullWidth = false): string {
  return `bb-pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-center text-base font-semibold ${VARIANT_CLASS[variant]} ${fullWidth ? "w-full" : ""}`;
}
