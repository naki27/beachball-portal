"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseDraft, removeDraft, writeDraft } from "@/lib/draft";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // プライベートモードなどで localStorage が使えない
  }
}

// localStorage は React の外にあるストアなので、useSyncExternalStore で読む（保存・削除のあとは notify で読み直す）
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  listeners.get(key)?.forEach((cb) => cb());
}

function subscribeTo(key: string) {
  return (cb: () => void) => {
    const set = listeners.get(key) ?? new Set<() => void>();
    set.add(cb);
    listeners.set(key, set);
    return () => {
      set.delete(cb);
    };
  };
}

const getServerSnapshot = () => null;

// 入力の一時保存の hook（§4.3「通信」）。key は src/lib/draft.ts の draftKey() で作る
// - 最初に読めた値を restored で返し、onRestore で 1 回だけ知らせる（フォームの初期値に使う）
// - save は少し待ってからまとめて書く（打つたびに書かない）
// - clear は送信が完了したときに必ず呼ぶ（生年月日を残さない）
export function useDraft<T>(key: string, options: { onRestore?: (value: T) => void; delayMs?: number } = {}) {
  const { onRestore, delayMs = 500 } = options;
  const subscribe = useMemo(() => subscribeTo(key), [key]);
  const getSnapshot = useCallback(() => storage()?.getItem(key) ?? null, [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // 期限の判定（今の時刻）は parseDraft の中で行う（render の中で Date.now() を呼ばない）
  const restored = useMemo(() => (raw === null ? null : parseDraft<T>(raw)), [raw]);

  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRestoreRef = useRef(onRestore);
  const announcedRef = useRef(false);

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  // 最初に読めた値だけを知らせる（自分の save で読み直した値では呼ばない）
  useEffect(() => {
    if (restored === null || announcedRef.current) return;
    announcedRef.current = true;
    onRestoreRef.current?.(restored);
  }, [restored]);

  const save = useCallback(
    (value: T) => {
      const s = storage();
      if (!s) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        writeDraft(s, key, value);
        notify(key);
        setSavedAt(new Date());
      }, delayMs);
    },
    [key, delayMs],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const s = storage();
    if (s) removeDraft(s, key);
    notify(key);
    setSavedAt(null);
  }, [key]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { restored, savedAt, save, clear };
}
