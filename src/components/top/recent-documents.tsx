import { DocumentLink } from "@/components/tournaments/document-link";
import { formatBytes } from "@/lib/documents/document-input";
import type { RecentPublicDocument } from "@/lib/public/documents";

// 協会のトップの「新しい資料」ブロック（設計書 §5.17 の既定の並び・§5.9）。公開中の資料がなければ枠ごと出さない
export function RecentDocuments({ slug, documents }: { slug: string; documents: RecentPublicDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <section aria-labelledby="recent-documents" className="flex flex-col gap-3">
      <h2 id="recent-documents" className="text-lg font-bold">
        新しい資料
      </h2>
      <ul className="flex flex-col gap-2">
        {documents.map((d) => (
          <li key={d.id}>
            <DocumentLink
              href={`/${slug}/tournaments/${d.tournamentId}/documents/${d.id}`}
              title={d.title}
              meta={`${d.tournamentName}・${d.docType}・PDF ${formatBytes(d.sizeBytes)}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
