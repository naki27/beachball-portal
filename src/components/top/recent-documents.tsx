import Link from "next/link";
import { formatFileSize } from "@/lib/documents/document-input";
import type { RecentDocument } from "@/lib/public/tournaments";

// トップページの「新しい資料」（設計書 §5.17「表示」の既定の並び 3 つめ）。誰でも見られる
// 並びのカスタマイズは P1。ここは既定の表示だけ
export function RecentDocuments({ slug, documents }: { slug: string; documents: RecentDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <section aria-labelledby="recent-documents" className="flex flex-col gap-3">
      <h2 id="recent-documents" className="text-xl font-bold">
        新しい資料
      </h2>
      <ul className="flex flex-col gap-2">
        {documents.map((document) => (
          <li key={document.id}>
            <Link
              href={`/${slug}/tournaments/${document.tournamentId}/documents/${document.id}`}
              className="bb-pressable flex min-h-12 flex-col justify-center gap-0.5 rounded-md border border-border px-4 py-2 no-underline"
            >
              <span className="font-semibold break-words underline underline-offset-2">{document.title}</span>
              <span className="text-sm text-muted">
                {document.tournamentName}・{document.docType}・PDF {formatFileSize(document.sizeBytes)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
