"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};
const yes = () => true;
const no = () => false;

// クライアントでハイドレーションが済んだか。サーバーの描画とハイドレーション中は false、そのあと true
// 用途: ブラウザにしかないもの（sessionStorage など）を出す前の判定、E2E が押してよいことを知るための印（data-hydrated）
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, yes, no);
}
