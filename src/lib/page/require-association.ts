import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import type { Association } from "@/lib/repo/associations";
import { resolveAssociation } from "@/lib/resolve-association";
import { redirectTargetFor } from "@/lib/slug";

// 協会の画面（/[slug]/…）の layout と page が最初に呼ぶ。見つからなければ 404、旧スラッグなら 308
// layout と page は同時に描画されるので、どちらも呼ぶ（解決は cache で 1 回）
export async function requireAssociation(slug: string): Promise<Association> {
  const resolution = await resolveAssociation(slug);
  if (resolution.kind === "not_found") notFound();
  if (resolution.kind === "redirect") {
    // 元の URL は proxy が x-url に入れている（パスと検索文字列）。なければスラッグだけ置き換える
    const url = (await headers()).get("x-url") ?? `/${slug}`;
    permanentRedirect(redirectTargetFor(url, resolution.currentSlug));
  }
  return resolution.association;
}
