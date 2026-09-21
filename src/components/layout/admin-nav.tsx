"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 管理画面の案内（設計書 §4.2 #13〜#19・§4.3 v0.9.6）
// PC（1280px 以上）は左に貼り付く縦並び、それより狭いときは本文の上に折り返して並べる。
// 今いるところは色を変え、`aria-current="page"` を付ける（色だけに頼らない）
const ITEMS = [
  { path: "tournaments", label: "大会の管理" },
  { path: "teams", label: "チーム管理" },
  { path: "members", label: "メンバー管理" },
  { path: "memberships", label: "協会員の管理" },
  { path: "contacts", label: "問い合わせ管理" },
  { path: "trash", label: "削除済みデータ" },
  { path: "association", label: "協会の設定" },
] as const;

export function AdminNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/${slug}/admin`;
  // 管理のトップは項目の一覧そのものなので、横の案内は出さない（同じリンクを二重に出さない）
  if (pathname === base) return null;
  return (
    <nav
      aria-label="管理の項目"
      className="border-b border-border bg-surface px-4 py-3 sm:px-6 lg:sticky lg:top-24 lg:w-56 lg:shrink-0 lg:self-start lg:border-0 lg:bg-transparent lg:py-8 lg:pl-4 lg:pr-0"
    >
      <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
        <li>
          <NavLink href={base} label="管理のトップ" current={false} />
        </li>
        {ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              href={`${base}/${item.path}`}
              label={item.label}
              current={pathname === `${base}/${item.path}` || pathname.startsWith(`${base}/${item.path}/`)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NavLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`bb-pressable flex min-h-11 items-center rounded-md px-3 text-sm font-semibold no-underline lg:min-h-12 lg:text-base ${
        current
          ? "bg-primary text-on-primary shadow-sm"
          : "border border-border-strong bg-background hover:border-primary hover:bg-primary-soft lg:border-0 lg:bg-transparent"
      }`}
    >
      {label}
    </Link>
  );
}
