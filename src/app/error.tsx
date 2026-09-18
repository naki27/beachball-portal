"use client";

import Link from "next/link";
import { useEffect } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/button-classes";
import { slugFromUrl } from "@/lib/slug";

// 500（想定しない失敗）。クライアント部品なので DB には触れない。協会のトップは URL の先頭から推定する
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 個人情報を含まない digest だけを記録する（本文はサーバーのログにある）
    console.error("page error", error.digest ?? "");
  }, [error]);

  const slug = typeof window === "undefined" ? null : slugFromUrl(window.location.pathname);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">しばらくしてからもう一度お試しください</h1>
      <p className="leading-relaxed">ページを表示できませんでした。時間をおいてから、もう一度開いてください。</p>
      <div className="flex flex-col gap-3">
        <button type="button" onClick={reset} className={primaryButtonClass}>
          もう一度試す
        </button>
        <Link href={slug ? `/${slug}` : "/"} className={secondaryButtonClass}>
          トップへ戻る
        </Link>
      </div>
    </main>
  );
}
