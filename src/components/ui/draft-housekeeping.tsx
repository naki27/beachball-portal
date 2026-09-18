"use client";

import { useEffect } from "react";
import { purgeExpiredDrafts } from "@/lib/draft";

// 保存から 7 日経った一時保存を、ページを開いたときに消す（§4.3「通信」）。画面には何も出さない
export function DraftHousekeeping() {
  useEffect(() => {
    try {
      purgeExpiredDrafts(window.localStorage);
    } catch {
      // localStorage が使えない環境では何もしない
    }
  }, []);
  return null;
}
