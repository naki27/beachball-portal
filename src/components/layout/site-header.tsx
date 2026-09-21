import Link from "next/link";
import type { ReactNode } from "react";
import { SiteMark } from "./site-mark";

// ページ上部のヘッダ。協会のページは協会名、協会に属さないページはサイト名（§4.4「テナントは出さない」）
// 右側にログイン・メニューなどを置く（A-08・A-13）。スクロールしても上に残す（PC・スマホとも）
export function SiteHeader({ title, href, right }: { title: string; href: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      {/* 上辺のブランドの線。協会の色に差し替わる */}
      <div aria-hidden="true" className="h-1 w-full" style={{ backgroundImage: "var(--gradient-brand)" }} />
      <div className="mx-auto flex min-h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href={href}
          className="bb-pressable flex min-h-12 min-w-0 items-center gap-2 py-2 text-lg font-bold no-underline hover:text-primary"
        >
          <SiteMark className="size-7 shrink-0" />
          <span className="min-w-0 truncate">{title}</span>
        </Link>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
    </header>
  );
}
