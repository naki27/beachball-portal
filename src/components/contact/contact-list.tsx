"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";
import { subjectLabel } from "@/lib/contact-subjects";
import type { ContactListRow, ContactStatus } from "@/lib/contact-admin";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";

// 問い合わせの一覧（設計書 §5.10）。対応済みにする・未対応に戻す。本文は変えられない
// deleteEndpoint を渡すと「削除する」を出す（協会宛てだけ。復元は /admin/trash・§5.16）
type Props = { rows: ContactListRow[]; endpoint: string; deleteEndpoint?: string };

export function ContactList({ rows, endpoint, deleteEndpoint }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: ContactStatus) {
    if (pendingId) return;
    setPendingId(id);
    setError(null);
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setPendingId(null);
    if (!response.ok) {
      setError("状態を変えられませんでした。画面を開き直して、もう一度お試しください。");
      return;
    }
    router.refresh();
  }

  async function remove(id: string) {
    if (pendingId) return;
    setPendingId(id);
    setError(null);
    const response = await fetch(`${deleteEndpoint}/${id}`, { method: "DELETE" });
    setPendingId(null);
    if (!response.ok) {
      setError("削除できませんでした。画面を開き直して、もう一度お試しください。");
      return;
    }
    setConfirmId(null);
    router.refresh();
  }

  if (rows.length === 0) return <p className="leading-relaxed">お問い合わせはありません。</p>;

  return (
    <div data-hydrated={hydrated ? "" : undefined} className="flex flex-col gap-4">
      {error ? <Message kind="error" title={error} /> : null}
      {rows.map((row) => (
        <article key={row.id} className="flex flex-col gap-3 rounded-md border border-border px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-semibold break-words">{subjectLabel(row.subjectType)}</h2>
            <span className={`text-sm font-semibold ${row.status === "done" ? "text-muted" : "text-danger"}`}>
              {row.status === "done" ? "対応済み" : "未対応"}
            </span>
          </div>
          <p className="text-sm text-muted break-words">
            {formatDateWithWeekday(todayInTokyo(new Date(row.createdAt)))}・{row.senderName}
          </p>
          <p className="whitespace-pre-wrap break-words leading-relaxed">{row.body}</p>
          <p className="text-sm break-all">
            返信先: <a href={`mailto:${row.senderEmail}`} className="underline underline-offset-2">{row.senderEmail}</a>
          </p>
          {confirmId === row.id ? (
            <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-3 py-2">
              <p className="text-sm">このお問い合わせを削除します。削除済みデータから元に戻せます。</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="danger" size="sm" pending={pendingId === row.id} onClick={() => remove(row.id)}>
                  削除する
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmId(null)}>
                  やめる
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {row.status === "done" ? (
                <Button type="button" variant="secondary" pending={pendingId === row.id} onClick={() => setStatus(row.id, "new")}>
                  未対応に戻す
                </Button>
              ) : (
                <Button type="button" variant="secondary" pending={pendingId === row.id} onClick={() => setStatus(row.id, "done")}>
                  対応済みにする
                </Button>
              )}
              {deleteEndpoint ? (
                <Button type="button" variant="secondary" onClick={() => setConfirmId(row.id)}>
                  削除する
                </Button>
              ) : null}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
