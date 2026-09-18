// ボタンの見た目（仮。共通部品は A-06 で作る）。サーバー・クライアントの両方の部品から使うので、ここにはサーバー専用の import を置かない
// 色は CSS 変数（協会ごとに差し替える・§5.17）。高さ 48px は指で押しやすい大きさ（§4.3）
export const primaryButtonClass =
  "inline-flex min-h-12 items-center justify-center rounded-md bg-[var(--color-primary)] px-4 text-center font-semibold text-[var(--color-on-primary)]";

export const secondaryButtonClass =
  "inline-flex min-h-12 items-center justify-center rounded-md border border-[var(--color-border)] px-4 text-center font-semibold";
