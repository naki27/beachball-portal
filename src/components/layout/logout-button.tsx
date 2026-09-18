"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { clearAllDrafts } from "@/lib/draft";

// ログアウト。セッションを消し、入力の一時保存（生年月日を含む）もブラウザから消す（§4.3）
// 読み込みの途中（スクリプトが動く前）は押せない。メニューは開けるので、押しても何も起きない状態を作らない
// 移る先: 協会のページからはその協会のトップ、協会に属さないページからはログイン画面（/ は未ログインだと 403 のため）
export function LogoutButton({ redirectTo = "/login" }: { redirectTo?: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) return;
    setPending(true);
    try {
      clearAllDrafts(window.localStorage);
    } catch {
      // localStorage が使えない環境では何もしない
    }
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push(redirectTo);
      router.refresh(); // サーバー側の描画（ヘッダのログイン状態）を取り直す
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending || !hydrated}
      className="bb-pressable inline-flex min-h-12 items-center px-2 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
    >
      {pending ? "ログアウトしています…" : "ログアウト"}
    </button>
  );
}
