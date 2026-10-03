import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { resolvePublicDocumentUrl } from "@/lib/public/documents";
import { resolveAssociation } from "@/lib/resolve-association";
import { redirectTargetFor } from "@/lib/slug";
import { TeamError } from "@/lib/teams/errors";

type Props = { params: Promise<{ slug: string; tournamentId: string; documentId: string }> };

// GET /[slug]/tournaments/[tournamentId]/documents/[documentId] — 大会資料を開く（設計書 §5.9「配信の仕組み」）
// 利用者が共有するのはこの URL（期限なし）。公開中なら公開用の URL へ 302、そうでなければ 404
export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId, documentId } = await params;
  const resolution = await resolveAssociation(slug);
  if (resolution.kind === "not_found") notFound();
  if (resolution.kind === "redirect") {
    return Response.redirect(new URL(redirectTargetFor(request.url, resolution.currentSlug), request.url), 308);
  }
  try {
    const url = await resolvePublicDocumentUrl(getDb(), resolution.association.id, tournamentId, documentId);
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof TeamError && error.status === 404) notFound();
    throw error;
  }
}
