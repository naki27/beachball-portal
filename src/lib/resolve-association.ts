import { cache } from "react";
import { getDb } from "@/db/client";
import { type Association, findAssociationById, resolveAssociationSlug } from "@/lib/repo/associations";
import { classifySlug } from "@/lib/slug";

export type AssociationResolution =
  | { kind: "found"; association: Association }
  // 旧スラッグ。新しいスラッグへ 308 で転送する（パスの残りと検索文字列は保つ）
  | { kind: "redirect"; association: Association; currentSlug: string }
  // 予約語・形が違う・どのスラッグにも当たらない → 404
  | { kind: "not_found" };

// URL のスラッグから協会を決める処理はここ 1 か所（設計書 §5.14「URL とテナント」の解決順 ①〜④）
// 画面（layout・page）と API の両方が使う。同じリクエストの中では 1 回しか DB を読まない（React の cache）
export const resolveAssociation = cache(async (slug: string): Promise<AssociationResolution> => {
  if (classifySlug(slug) !== "candidate") return { kind: "not_found" };
  const db = getDb();
  const hit = await resolveAssociationSlug(db, slug);
  if (!hit) return { kind: "not_found" };
  const association = await findAssociationById(db, hit.associationId);
  if (!association) return { kind: "not_found" };
  return hit.redirected ? { kind: "redirect", association, currentSlug: hit.currentSlug } : { kind: "found", association };
});
