import { headers } from "next/headers";
import Link from "next/link";
import { slugFromUrl } from "@/lib/slug";
import { SITE_NAME } from "@/lib/site";

// フッタ。プライバシーポリシー・利用規約（§5.18）。困ったときの行き先は問い合わせフォームだけ
// 協会の画面から開いたときは、その協会宛ての問い合わせへ（§5.10）。元の URL は proxy が x-url に入れている
export async function SiteFooter() {
  const slug = slugFromUrl((await headers()).get("x-url") ?? "/");
  const linkClass = "bb-link inline-flex min-h-10 items-center text-muted no-underline hover:text-primary";
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="font-semibold text-muted">{SITE_NAME}</p>
        <nav aria-label="サイトの案内" className="flex flex-wrap gap-x-6 gap-y-1">
          <Link href={slug ? `/${slug}/contact` : "/contact"} className={linkClass}>
            お問い合わせ
          </Link>
          <Link href="/privacy" className={linkClass}>
            プライバシーポリシー
          </Link>
          <Link href="/terms" className={linkClass}>
            利用規約
          </Link>
        </nav>
      </div>
    </footer>
  );
}
