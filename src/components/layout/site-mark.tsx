// サイトの印（ビーチボール）。文字ではないので読み上げの対象にしない
// 色は CSS 変数（協会ごとに差し替える・§5.17）。動かさない（§4.5 原則 1）
export function SiteMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14" fill="var(--brand-500)" />
      <path d="M16 2a14 14 0 0 1 0 28 22 22 0 0 0 0-28Z" fill="var(--accent-400)" />
      <path d="M16 2a14 14 0 0 0 0 28 22 22 0 0 1 0-28Z" fill="var(--brand-300)" />
      <circle cx="16" cy="16" r="3.5" fill="#ffffff" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="var(--brand-700)" strokeWidth="1.5" />
    </svg>
  );
}
