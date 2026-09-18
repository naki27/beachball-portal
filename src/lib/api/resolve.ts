import type { Association } from "@/lib/repo/associations";
import { resolveAssociation } from "@/lib/resolve-association";
import { redirectTargetFor } from "@/lib/slug";
import { jsonError } from "./errors";

// API（/api/[slug]/…）の Route Handler が最初に呼ぶ。画面と同じ解決順（§5.14）
// 見つからなければ 404 の JSON、旧スラッグなら新しい URL へ 308。どちらも Response なので、そのまま返す
export async function resolveAssociationForApi(
  slug: string,
  request: Request,
): Promise<{ association: Association } | Response> {
  const resolution = await resolveAssociation(slug);
  if (resolution.kind === "not_found") return jsonError(404, "ページが見つかりません");
  if (resolution.kind === "redirect") {
    const target = new URL(redirectTargetFor(request.url, resolution.currentSlug), request.url);
    return Response.redirect(target, 308);
  }
  return { association: resolution.association };
}
