import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "accent" | "danger" | "ghost";
export type ButtonSize = "md" | "sm";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary shadow-sm hover:bg-primary-strong hover:shadow-md active:bg-primary-strong",
  secondary:
    "border border-border-strong bg-background text-foreground hover:border-primary hover:bg-primary-soft active:bg-surface",
  accent: "bg-accent text-on-primary shadow-sm hover:bg-accent-strong hover:shadow-md active:bg-accent-strong",
  danger: "border border-danger bg-background text-danger hover:bg-danger-surface active:bg-danger-surface",
  ghost: "text-primary hover:bg-primary-soft active:bg-primary-soft",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  // 48px は指で押しやすい大きさ（§4.3）。主要操作はこちら
  md: "min-h-12 px-5 text-base",
  // 一覧の中の補助的な操作。44px までは小さくしてよい（§4.3）
  sm: "min-h-11 px-3 text-sm",
};

const BASE =
  "bb-pressable inline-flex items-center justify-center gap-2 rounded-md text-center font-semibold disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none";

// ボタン（§4.5「共通」）。押した瞬間に色が濃くなり沈む。送信中は文字が「送信しています…」になり押せなくなる（二度押しを防ぐ）
// マウスのある端末だけ、乗せたときに色が濃くなり影が増す（指の端末では起きない）
export function Button({
  variant = "primary",
  size = "md",
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
  size?: ButtonSize;
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
      className={`${BASE} ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${fullWidth ? "w-full" : ""} ${className}`}
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
export function buttonClass(variant: ButtonVariant = "primary", fullWidth = false, size: ButtonSize = "md"): string {
  return `${BASE} no-underline ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${fullWidth ? "w-full" : ""}`;
}
