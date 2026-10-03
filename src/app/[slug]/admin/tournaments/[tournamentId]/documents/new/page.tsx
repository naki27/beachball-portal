import type { Metadata } from "next";
import Link from "next/link";
import { DocumentUploadForm } from "@/components/tournaments/document-upload-form";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { getDocumentsForAdmin } from "@/lib/admin/documents";
import { getPrincipal } from "@/lib/auth/principal";
import { MAX_DOCUMENT_BYTES_TEXT } from "@/lib/documents/document-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "資料を追加する" };

// 大会資料を追加するページ（設計書 §5.9・§4.3「一覧と登録はページを分ける」）。テナント管理者だけ
// 一覧と同じ読み込みを通すので、権限がないときはここでも 403 になる
export default async function NewTournamentDocumentPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const view = await getDocumentsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, tournamentId).catch(pageErrorFrom);

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/admin/tournaments/${view.tournament.id}/documents`} className="bb-link text-primary">
          ← 大会資料
        </Link>
      </p>
      <PageHeader
        title="資料を追加する"
        lead={`大会冊子・要項・組み合わせ・結果などの PDF を置きます（1 ファイル ${MAX_DOCUMENT_BYTES_TEXT} まで）。`}
      />
      <DocumentUploadForm slug={association.slug} tournamentId={view.tournament.id} />
    </PageMain>
  );
}
