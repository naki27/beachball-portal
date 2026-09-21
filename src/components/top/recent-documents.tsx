import Link from "next/link";
import { Badge, Card, Section } from "@/components/ui/layout";
import { formatFileSize } from "@/lib/documents/document-input";
import type { RecentDocument } from "@/lib/public/tournaments";

// トップページの「新しい資料」（設計書 §5.17「表示」の既定の並び 3 つめ）。誰でも見られる
// 並びのカスタマイズは P1。ここは既定の表示だけ
export function RecentDocuments({ slug, documents }: { slug: string; documents: RecentDocument[] }) {
  if (documents.length === 0) return null;
  return (
    <Section id="recent-documents" title="新しい資料">
      <ul className="bb-stagger grid gap-3 md:grid-cols-2">
        {documents.map((document) => (
          <li key={document.id}>
            <Link
              href={`/${slug}/tournaments/${document.tournamentId}/documents/${document.id}`}
              className="block h-full no-underline"
            >
              <Card interactive className="flex h-full flex-col gap-1">
                <span className="font-semibold break-words">{document.title}</span>
                <span className="text-sm text-muted">{document.tournamentName}</span>
                <span className="mt-auto pt-1">
                  <Badge tone="accent">
                    {document.docType}・PDF {formatFileSize(document.sizeBytes)}
                  </Badge>
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
