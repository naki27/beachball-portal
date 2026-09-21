// ボタンの見た目のうち、サーバー・クライアントのどちらからも使う分。サーバー専用の import を置かない
// 中身は src/components/ui/button.tsx の buttonClass と同じ形にそろえる（色は CSS 変数・§5.17）
export const primaryButtonClass =
  "bb-pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 text-center text-base font-semibold text-on-primary no-underline shadow-sm hover:bg-primary-strong hover:shadow-md active:bg-primary-strong";

export const secondaryButtonClass =
  "bb-pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-border-strong bg-background px-5 text-center text-base font-semibold no-underline hover:border-primary hover:bg-primary-soft active:bg-surface";
