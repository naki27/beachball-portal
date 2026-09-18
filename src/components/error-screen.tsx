import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/button-classes";
import { resolveAssociation } from "@/lib/resolve-association";
import { slugFromUrl } from "@/lib/slug";

// エラーページ（§4.2 #25）の共通の形。内部の用語やエラーコードは出さない。どれにも協会のトップへ戻るボタンを置く
// 協会のページの中（/[slug]/…）なら、その協会のトップへ。協会が決まらなければサイトのトップへ

export type ErrorAction = { href: string; label: string };

// 「協会のトップへ戻る」の行き先。元の URL は proxy が x-url に入れている
export async function topLink(): Promise<{ href: string; label: string }> {
  const url = (await headers()).get("x-url") ?? "/";
  const slug = slugFromUrl(url);
  if (slug) {
    const resolution = await resolveAssociation(slug);
    if (resolution.kind !== "not_found") {
      return { href: `/${resolution.association.slug}`, label: `${resolution.association.name}のトップへ戻る` };
    }
  }
  return { href: "/", label: "トップへ戻る" };
}

export async function ErrorScreen({
  title,
  action,
  children,
}: {
  title: string;
  // 主な操作（例: ログインする）。なければ「トップへ戻る」だけ
  action?: ErrorAction;
  children?: ReactNode;
}) {
  const top = await topLink();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children ? <div className="leading-relaxed">{children}</div> : null}
      <div className="flex flex-col gap-3">
        {action ? (
          <Link href={action.href} className={primaryButtonClass}>
            {action.label}
          </Link>
        ) : null}
        <Link href={top.href} className={secondaryButtonClass}>
          {top.label}
        </Link>
      </div>
    </main>
  );
}
