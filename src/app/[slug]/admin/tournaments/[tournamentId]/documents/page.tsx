import type { Metadata } from "next";
import Link from "next/link";
import { DocumentManager, type DocumentRow } from "@/components/tournaments/document-manager";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { type AdminDocumentsView, getDocumentsForAdmin } from "@/lib/admin/documents";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateTimeTokyo } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { getStorage } from "@/lib/storage";

type Props = {
  params: Promise<{ slug: string; tournamentId: string }>;
  searchParams: Promise<{ added?: string }>;
};

export const metadata: Metadata = { title: "大会の資料" };

// 大会資料の一覧（設計書 §4.2 #13・§5.9）。テナント管理者だけ。追加は …/documents/new
export default async function TournamentDocumentsPage({ params, searchParams }: Props) {
  const { slug, tournamentId } = await params;
  const { added } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const view = await getDocumentsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, tournamentId).catch(
    pageErrorFrom,
  );
  const storage = getStorage();

  return (
    <PageMain width="wide">
      <p>
        <Link href={`/${association.slug}/admin/tournaments/${view.tournament.id}`} className="bb-link text-primary">
          ← {view.tournament.name}
        </Link>
      </p>
      <PageHeader eyebrow={view.tournament.name} title="大会の資料" />
      <DocumentManager
        slug={association.slug}
        tournamentId={view.tournament.id}
        documents={view.documents.map((row) => toRow(row, storage.publicUrl.bind(storage)))}
        isDraftTournament={view.tournament.status === "draft"}
        addedId={added ?? null}
      />
    </PageMain>
  );
}

function toRow(document: AdminDocumentsView["documents"][number], publicUrl: (key: string) => string): DocumentRow {
  return {
    id: document.id,
    docType: document.docType,
    title: document.title,
    sizeBytes: document.sizeBytes,
    isPublic: document.isPublic,
    sortOrder: String(document.sortOrder),
    published: document.publicKey !== null,
    createdAtText: formatDateTimeTokyo(document.createdAt),
    publicUrl: document.publicKey ? publicUrl(document.publicKey) : null,
  };
}
