import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AuthMenu } from "@/components/layout/auth-menu";
import { EnteredBanner } from "@/components/layout/entered-banner";
import { SiteHeader } from "@/components/layout/site-header";
import { getPrincipal } from "@/lib/auth/principal";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { children: ReactNode; params: Promise<{ slug: string }> };

// タブの題名: 協会のページは「ページ名｜協会名」。協会のトップはページ名なしで協会名だけ
// absolute にしないと、ルートの layout の template（｜サイト名）が協会名に重なる
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  return { title: { absolute: association.name, template: `%s｜${association.name}` } };
}

// 協会の画面（/[slug]/…）。スラッグから協会を決め、なければ 404、旧スラッグなら 308（§5.14）。ヘッダは協会名
// 運営管理者が切り替えて入っている間は「運営管理者として ◯◯協会を表示中」の帯を出す
export default async function AssociationLayout({ children, params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const currentPath = (await headers()).get("x-url") ?? `/${association.slug}`;
  const principal = await getPrincipal();
  const entered = principal.isPlatformAdmin && principal.enteredAssociationId === association.id;
  return (
    <>
      {entered ? <EnteredBanner associationId={association.id} associationName={association.name} /> : null}
      <SiteHeader title={association.name} href={`/${association.slug}`} right={<AuthMenu currentPath={currentPath} />} />
      {children}
    </>
  );
}
