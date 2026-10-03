// 封筒（§4.5「確認番号を送った: 封筒のアイコンが 1 回動き」）。飾りなので読み上げの対象にしない
// 「視差効果を減らす」が ON なら動かない（--motion-slow が 0ms になる）
export function EnvelopeIcon({ className = "size-7" }: { className?: string }) {
  return (
    <svg className={`bb-nudge ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="var(--brand-100)" stroke="var(--color-primary)" strokeWidth="1.6" />
      <path d="M3.5 7l8.5 6 8.5-6" stroke="var(--color-primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
