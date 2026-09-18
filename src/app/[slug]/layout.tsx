import type { ReactNode } from "react";
import { requireAssociation } from "@/lib/page/require-association";

// 協会の画面（/[slug]/…）。スラッグから協会を決め、なければ 404、旧スラッグなら 308（§5.14）
// 協会名のヘッダ・ナビなどの共通部品は A-06 で足す
export default async function AssociationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireAssociation(slug);
  return <>{children}</>;
}
