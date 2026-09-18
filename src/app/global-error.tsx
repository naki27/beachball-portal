"use client";

import Link from "next/link";

// ルートの layout が壊れたときの 500。html と body を自分で出す
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem 1rem", maxWidth: "36rem", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>しばらくしてからもう一度お試しください</h1>
        <p style={{ lineHeight: 1.7 }}>ページを表示できませんでした。時間をおいてから、もう一度開いてください。</p>
        <p style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <button type="button" onClick={reset} style={{ minHeight: "3rem", fontWeight: 600 }}>
            もう一度試す
          </button>
          <Link href="/" style={{ minHeight: "3rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            トップへ戻る
          </Link>
        </p>
      </body>
    </html>
  );
}
