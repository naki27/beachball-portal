import type { ComponentProps, ReactNode } from "react";

// 入力欄（§4.3・§4.5）。誤りがあれば赤枠になり 1 回だけ揺れ、欄の下に理由を出す
// inputMode・autoComplete は使う画面が正しく付ける（メールは type="email" inputMode="email" autoComplete="email"）
// ふりがなの inputmode="kana" は現在の規格にないので付けない（docs/adr/0004）
export function TextField({
  id,
  label,
  hint,
  error,
  className = "",
  ...rest
}: ComponentProps<"input"> & {
  id: string;
  label: ReactNode;
  // 入力欄の下に常時出す短い注意書き（例: 全角の英数字は半角に変換されます）
  hint?: ReactNode;
  // 誤りの理由。あれば赤枠・揺れ・aria-invalid
  error?: string | null;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-12 w-full rounded-md border bg-background px-3 text-base ${
          error ? "bb-shake border-2 border-danger" : "border-border"
        }`}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
