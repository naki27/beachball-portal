"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { PURGE_REASON_KEYS, PURGE_REASON_LABEL, type PurgeReasonKind } from "@/lib/admin/purge-reasons";
import type { TrashItem, TrashTable } from "@/lib/admin/trash";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";

type Props = { slug: string; table: TrashTable; label: string; items: TrashItem[] };

// 復元と「完全に削除」（2 段階の確認 + 理由・§5.16）
export function TrashList({ slug, table, label, items }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // 人物を消すときは、理由で申込の記録の残り方が変わる（§5.16）
  const [reasonKind, setReasonKind] = useState<PurgeReasonKind>("other");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function restore(item: TrashItem) {
    if (pendingId) return;
    setPendingId(item.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/${slug}/admin/trash/${table}/${item.id}/restore`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "元に戻せませんでした");
        return;
      }
      setNotice(`「${item.title}」を元に戻しました`);
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function purge(item: TrashItem) {
    if (pendingId) return;
    setPendingId(item.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/${slug}/admin/trash/${table}/${item.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, reason_kind: reasonKind }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "完全に削除できませんでした");
        return;
      }
      setConfirmId(null);
      setReason("");
      setNotice(`「${item.title}」を完全に削除しました`);
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <>
        {notice ? <Message kind="success" title={notice} /> : null}
        <p className="leading-relaxed">削除された{label}はありません。</p>
      </>
    );
  }

  return (
    <div data-hydrated={hydrated ? "" : undefined} className="flex flex-col gap-4">
      {error ? <Message kind="error" title={error} /> : null}
      {notice ? <Message kind="success" title={notice} /> : null}
      {items.map((item) => (
        <article key={item.id} className="flex flex-col gap-3 rounded-md border border-border px-4 py-4">
          <div>
            <h2 className="font-semibold break-words">{item.title}</h2>
            <p className="text-sm text-muted break-words">{item.detail}</p>
            <p className="text-sm text-muted">
              {formatDateWithWeekday(todayInTokyo(new Date(item.deletedAt)))}に削除
              {item.deletedByName ? `・${item.deletedByName}` : ""}
            </p>
          </div>

          {confirmId === item.id ? (
            <div className="flex flex-col gap-3 rounded-md border border-danger bg-danger-surface px-4 py-3">
              <p className="font-semibold text-danger">本当に完全に削除しますか？</p>
              <p className="leading-relaxed">{item.cascade}</p>
              <p className="leading-relaxed">元に戻せません。</p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`reason-kind-${item.id}`} className="font-semibold">
                  理由の種類
                </label>
                <select
                  id={`reason-kind-${item.id}`}
                  value={reasonKind}
                  onChange={(event) => setReasonKind(event.target.value as PurgeReasonKind)}
                  className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
                >
                  {PURGE_REASON_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {PURGE_REASON_LABEL[key]}
                    </option>
                  ))}
                </select>
                {table === "members" ? (
                  <p className="text-sm">
                    {reasonKind === "retention"
                      ? "申し込みの記録には氏名・性別・年齢が残り、生年月日だけが消えます。"
                      : "申し込みの記録の氏名・ふりがな・生年月日が「（削除済み）」になります（申し込みの件数は変わりません）。"}
                  </p>
                ) : null}
              </div>
              <TextField
                id={`reason-${item.id}`}
                label="理由のメモ"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                hint="例: 本人から削除の依頼あり（2026-09-20 受付）"
              />
              <Button
                type="button"
                variant="danger"
                pending={pendingId === item.id}
                pendingLabel="削除しています…"
                onClick={() => purge(item)}
              >
                完全に削除する
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setConfirmId(null);
                  setReason("");
                }}
              >
                やめる
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {item.restoreBlockedBy ? (
                <p className="text-sm text-muted leading-relaxed">{item.restoreBlockedBy}</p>
              ) : (
                <Button type="button" variant="secondary" pending={pendingId === item.id} onClick={() => restore(item)}>
                  元に戻す
                </Button>
              )}
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setConfirmId(item.id);
                  setReason("");
                  setError(null);
                }}
              >
                完全に削除する
              </Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
