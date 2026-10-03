// サイトの印（ビーチボール）。公式球（緑の球＋白い帯）をデフォルメしたもの。文字ではないので読み上げの対象にしない
// 色は CSS 変数（協会ごとに差し替える・§5.17）。動かさない（§4.5 原則 1）
// タブ・ホーム画面のアイコンは src/app/icon.svg（同じ形。変えるときは両方）
export function SiteMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="site-mark-ball">
          <circle cx="16" cy="16" r="14" />
        </clipPath>
      </defs>
      <circle cx="16" cy="16" r="14" fill="var(--brand-500)" />
      <path d="M0 11Q16 7 32 11L32 21Q16 25 0 21Z" fill="#ffffff" clipPath="url(#site-mark-ball)" />
      <ellipse cx="11" cy="7.5" rx="4.5" ry="2.6" fill="#ffffff" opacity="0.35" transform="rotate(-25 11 7.5)" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--brand-700)" strokeWidth="1.6" />
    </svg>
  );
}
