import Link from "next/link";
import type { ReactNode } from "react";

// ページ上部のヘッダ。協会のページは協会名、協会に属さないページはサイト名（§4.4「テナントは出さない」）
// 右側にログイン・メニューなどを置く（A-08・A-13）
export function SiteHeader({ title, href, right }: { title: string; href: string; right?: ReactNode }) {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex min-h-14 w-full max-w-xl items-center justify-between gap-3 px-4">
        <Link href={href} className="min-h-12 py-3 text-lg font-bold no-underline">
          {title}
        </Link>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
    </header>
  );
}
