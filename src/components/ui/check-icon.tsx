// 保存・完了のチェック（§4.5）。線が描かれる（300ms）。「視差効果を減らす」では最初から描かれている
export function CheckIcon({ className = "size-6", animated = true }: { className?: string; animated?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        className={animated ? "bb-draw" : undefined}
        d="M4 12.5l5 5L20 6.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
