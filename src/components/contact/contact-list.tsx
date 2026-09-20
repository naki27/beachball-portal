"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { subjectLabel } from "@/lib/contact-subjects";
import type { ContactListRow, ContactStatus } from "@/lib/contact-admin";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";

// 問い合わせの一覧（設計書 §5.10）。対応済みにする・未対応に戻す。本文は変えられない
type Props = { rows: ContactListRow[]; endpoint: string };

export function ContactList({ rows, endpoint }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
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

  if (rows.length === 0) return <p className="leading-relaxed">お問い合わせはありません。</p>;

  return (
    <div className="flex flex-col gap-4">
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
          {row.status === "done" ? (
            <Button type="button" variant="secondary" pending={pendingId === row.id} onClick={() => setStatus(row.id, "new")}>
              未対応に戻す
            </Button>
          ) : (
            <Button type="button" variant="secondary" pending={pendingId === row.id} onClick={() => setStatus(row.id, "done")}>
              対応済みにする
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}
