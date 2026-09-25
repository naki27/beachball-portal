import type { Metadata } from "next";
import Link from "next/link";
import { DocumentManager, type DocumentRowView } from "@/components/tournaments/document-manager";
import { getDb } from "@/db/client";
import { getDocumentsForAdmin } from "@/lib/admin/documents";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateTimeTokyo } from "@/lib/date";
import { formatBytes, MAX_DOCUMENT_BYTES_TEXT } from "@/lib/documents/document-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import type { TournamentDocument } from "@/lib/repo/tournament-documents";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "大会資料" };

// 大会資料のアップロードと一覧（設計書 §5.9）。テナント管理者だけ
export default async function TournamentDocumentsPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const view = await getDocumentsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, tournamentId).catch(pageErrorFrom);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin/tournaments/${view.tournament.id}`} className="underline underline-offset-2">
          ← {view.tournament.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold">大会資料</h1>
      <p className="text-sm text-muted">
        大会冊子・要項・組み合わせ・結果などの PDF を置きます（1 ファイル {MAX_DOCUMENT_BYTES_TEXT} まで）。
        「公開」にした資料は、大会のページから誰でも開けるようになります。
      </p>
      <DocumentManager slug={association.slug} tournamentId={view.tournament.id} documents={view.documents.map(toRow)} />
    </main>
  );
}

function toRow(d: TournamentDocument): DocumentRowView {
  return {
    id: d.id,
    docType: d.docType,
    title: d.title,
    isPublic: d.isPublic,
    sortOrder: d.sortOrder,
    sizeText: formatBytes(d.sizeBytes),
    createdText: formatDateTimeTokyo(d.createdAt),
  };
}
