"use client";

import { useEffect, useRef, useState } from "react";

// 大会資料を開くリンク（設計書 §5.9・§4.5）。新しいタブで PDF を開く。
// 押した直後は「開いています…」を出す（別のタブが開くまでこの画面は変わらないので、押せたことが分かるように）
// href はアプリの URL（期限なし。共有してよい）で、公開用のファイルへ転送される
export function DocumentLink({ href, title, meta }: { href: string; title: string; meta: string }) {
  const [opening, setOpening] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onClick() {
    setOpening(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpening(false), 4000);
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      onClick={onClick}
      className="bb-pressable flex min-h-14 flex-col justify-center gap-0.5 rounded-md border border-border px-4 py-3 no-underline"
    >
      <span className="font-semibold break-words underline underline-offset-2">{title}</span>
      <span className="text-sm text-muted" aria-live="polite">
        {opening ? "開いています…" : meta}
      </span>
    </a>
  );
}
