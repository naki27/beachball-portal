// 送信中の回転アイコン（§4.5）。文字（「送信しています…」）と必ず一緒に使う
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`bb-spin size-5 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
