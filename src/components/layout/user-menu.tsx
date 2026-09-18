"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { LogoutButton } from "./logout-button";

export type SwitchTarget = { name: string; slug: string };

// ヘッダ右上のメニュー（ログイン中）。マイページ・協会を切り替える（関わる協会が 2 つ以上のときだけ・§5.14）・ログアウト
// 協会の切り替えは別の協会の URL に移るだけ（サーバーに「今どの協会か」を持たない）
export function UserMenu({
  associations,
  currentSlug,
  showPlatform,
  logoutTo,
}: {
  associations: SwitchTarget[];
  currentSlug: string | null;
  showPlatform: boolean;
  logoutTo: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  // 画面を移ったら閉じる（ヘッダは layout にあるので、開いたまま残る）
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  const itemClass = "flex min-h-12 items-center px-4 no-underline hover:bg-surface";
  return (
    <details ref={ref} className="relative">
      <summary className="bb-pressable flex min-h-12 cursor-pointer list-none items-center gap-1 px-2 font-semibold [&::-webkit-details-marker]:hidden">
        メニュー
        <span aria-hidden="true" className="text-sm">
          ▼
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col rounded-md border border-border bg-background py-2 shadow-lg">
        <Link href="/mypage" className={itemClass}>
          マイページ
        </Link>
        {showPlatform ? (
          <Link href="/platform" className={itemClass}>
            運営管理
          </Link>
        ) : null}
        {associations.length > 0 ? (
          <nav aria-label="協会を切り替える" className="mt-1 border-t border-border pt-2">
            <p className="px-4 pb-1 text-sm text-muted">協会を切り替える</p>
            <ul>
              {associations.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={`/${a.slug}`}
                    aria-current={a.slug === currentSlug ? "page" : undefined}
                    className={`${itemClass} ${a.slug === currentSlug ? "font-semibold" : ""}`}
                  >
                    {a.name}
                    {a.slug === currentSlug ? <span className="ml-2 text-sm text-muted">（表示中）</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="mt-1 border-t border-border px-2 pt-2">
          <LogoutButton redirectTo={logoutTo} />
        </div>
      </div>
    </details>
  );
}
