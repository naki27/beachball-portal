"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearAllDrafts } from "@/lib/draft";

// ログアウト。セッションを消し、入力の一時保存（生年月日を含む）もブラウザから消す（§4.3）
export function LogoutButton() {
  const router = useRouter();
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
      router.push("/");
      router.refresh(); // サーバー側の描画（ヘッダのログイン状態）を取り直す
    }
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={pending}
      className="bb-pressable inline-flex min-h-12 items-center px-2 font-semibold underline-offset-2 hover:underline disabled:opacity-60"
    >
      {pending ? "ログアウトしています…" : "ログアウト"}
    </button>
  );
}
