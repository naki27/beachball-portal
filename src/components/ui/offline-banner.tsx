"use client";

import { useSyncExternalStore } from "react";

// 電波の状態は React の外にある（navigator.onLine と online / offline のイベント）ので、外部ストアとして読む
type NetworkState = { online: boolean; wasOffline: boolean };

const SERVER_STATE: NetworkState = { online: true, wasOffline: false };
let state: NetworkState | null = null;
const listeners = new Set<() => void>();

function current(): NetworkState {
  if (state === null) {
    const online = typeof navigator === "undefined" ? true : navigator.onLine;
    state = { online, wasOffline: !online };
  }
  return state;
}

function update(online: boolean): void {
  const prev = current();
  state = { online, wasOffline: prev.wasOffline || !online };
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const goOffline = () => update(false);
  const goOnline = () => update(true);
  window.addEventListener("offline", goOffline);
  window.addEventListener("online", goOnline);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("offline", goOffline);
    window.removeEventListener("online", goOnline);
  };
}

const getServerSnapshot = () => SERVER_STATE;

// 電波が切れた帯（§4.5）。画面上部に「電波が届いていません。入力した内容は残っています」。戻ったら「つながりました」に変わる
// 自動では消さない（次のページへ移るまで残す）
export function OfflineBanner() {
  const { online, wasOffline } = useSyncExternalStore(subscribe, current, getServerSnapshot);
  if (online && !wasOffline) return null;
  return (
    <div
      role="status"
      aria-live="assertive"
      className={`bb-slide-in sticky top-0 z-50 px-4 py-3 text-center font-semibold ${
        online ? "bg-success text-on-primary" : "bg-warning text-on-primary"
      }`}
    >
      {online ? "つながりました" : "電波が届いていません。入力した内容は残っています"}
    </div>
  );
}
