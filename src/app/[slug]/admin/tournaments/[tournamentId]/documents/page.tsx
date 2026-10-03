import type { Metadata } from "next";
import Link from "next/link";
import { DocumentManager, type DocumentRowView } from "@/components/tournaments/document-manager";
import { PageHeader, PageMain, Section } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { type AdminDocument, getDocumentsForAdmin } from "@/lib/admin/documents";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateTimeTokyo } from "@/lib/date";
import { formatBytes, MAX_DOCUMENT_BYTES_TEXT } from "@/lib/documents/document-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string; tournamentId: string }>; searchParams: Promise<{ added?: string }> };

export const metadata: Metadata = { title: "大会資料" };

// 大会資料の一覧（設計書 §5.9）。テナント管理者だけ。追加するのは別のページ（§4.3）
export default async function TournamentDocumentsPage({ params, searchParams }: Props) {
  const { slug, tournamentId } = await params;
  const { added } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const view = await getDocumentsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, tournamentId).catch(pageErrorFrom);

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/admin/tournaments/${view.tournament.id}`} className="bb-link text-primary">
          ← {view.tournament.name}
        </Link>
      </p>
      <PageHeader
        title="大会資料"
        lead={`大会冊子・要項・組み合わせ・結果などの PDF を置きます（1 ファイル ${MAX_DOCUMENT_BYTES_TEXT} まで）。「公開」にした資料は、大会のページから誰でも開けるようになります。`}
      />
      <Section id="documents" title={`アップロード済みの資料（${view.documents.length} 件）`}>
        <DocumentManager
          slug={association.slug}
          tournamentId={view.tournament.id}
          tournamentIsDraft={view.tournament.status === "draft"}
          documents={view.documents.map(toRow)}
          addedId={added ?? null}
        />
      </Section>
    </PageMain>
  );
}

function toRow(d: AdminDocument): DocumentRowView {
  return {
    id: d.id,
    docType: d.docType,
    title: d.title,
    isPublic: d.isPublic,
    published: d.published,
    sortOrder: d.sortOrder,
    sizeText: formatBytes(d.sizeBytes),
    createdText: formatDateTimeTokyo(d.createdAt),
  };
}
