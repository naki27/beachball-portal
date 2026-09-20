"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { slugFromUrl } from "@/lib/slug";

// フッタ。プライバシーポリシー・利用規約（画面は A-23）。困ったときの行き先は問い合わせフォームだけ
// 協会の画面から開いたときは、その協会宛ての問い合わせへ（§5.10）
export function SiteFooter() {
  const pathname = usePathname();
  const slug = slugFromUrl(pathname ?? "/");
  return (
    <footer className="mt-auto border-t border-border">
      <nav
        aria-label="サイトの案内"
        className="mx-auto flex w-full max-w-xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted"
      >
        <Link href={slug ? `/${slug}/contact` : "/contact"} className="inline-flex min-h-10 items-center underline underline-offset-2">
          お問い合わせ
        </Link>
        <Link href="/privacy" className="inline-flex min-h-10 items-center underline underline-offset-2">
          プライバシーポリシー
        </Link>
        <Link href="/terms" className="inline-flex min-h-10 items-center underline underline-offset-2">
          利用規約
        </Link>
      </nav>
    </footer>
  );
}
