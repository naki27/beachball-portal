import Link from "next/link";

// フッタ。プライバシーポリシー・利用規約（画面は A-23）。困ったときの行き先は問い合わせフォームだけ（A-22 で足す）
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <nav
        aria-label="サイトの案内"
        className="mx-auto flex w-full max-w-xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted"
      >
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
