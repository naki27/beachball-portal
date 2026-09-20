"use client";

import { useState } from "react";
import { formatFileSize } from "@/lib/documents/document-input";

// 公開されている大会資料の一覧（設計書 §5.9・§4.2 #6）。押すと公開用の URL へ転送される（302）
// PDF は開くまでに少し待つので、押したことが分かるように「開いています…」を出す（§4.5 原則 4）

export type DocumentLink = { id: string; docType: string; title: string; sizeBytes: number; href: string };

export function DocumentList({ documents }: { documents: DocumentLink[] }) {
  const [opening, setOpening] = useState<string | null>(null);
  if (documents.length === 0) return null;

  return (
    <section aria-labelledby="documents" className="flex flex-col gap-3">
      <h2 id="documents" className="text-lg font-bold">
        大会の資料
      </h2>
      <ul className="flex flex-col gap-2">
        {documents.map((document) => (
          <li key={document.id}>
            <a
              href={document.href}
              // 同じタブで開く（転送先は PDF。スマホの「戻る」で大会ページに戻れる）
              onClick={() => setOpening(document.id)}
              className="bb-pressable flex min-h-12 flex-col justify-center gap-0.5 rounded-md border border-border px-4 py-2 no-underline"
            >
              <span className="font-semibold break-words underline underline-offset-2">{document.title}</span>
              <span className="text-sm text-muted">
                {document.docType}・PDF {formatFileSize(document.sizeBytes)}
                {opening === document.id ? "・開いています…" : ""}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="sr-only">
        {opening ? "資料を開いています" : ""}
      </p>
    </section>
  );
}
