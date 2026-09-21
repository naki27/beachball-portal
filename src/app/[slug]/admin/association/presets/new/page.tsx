import type { Metadata } from "next";
import Link from "next/link";
import { PresetNewForm } from "@/components/tournaments/preset-new-form";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { listPresetsForAdmin } from "@/lib/admin/category-presets";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "新しい部を足す" };

// 「よく使う部」を足すページ（設計書 §5.4・§4.3「一覧と登録はページを分ける」）。テナント管理者だけ
// 一覧と同じ読み込みを通すので、権限がないときはここでも 403 になる
export default async function NewPresetPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  await listPresetsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id).catch(pageErrorFrom);

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/admin/association`} className="bb-link text-primary">
          ← 協会の設定
        </Link>
      </p>
      <PageHeader title="新しい部を足す" lead="大会に部を足すときの候補になります。" />
      <PresetNewForm slug={association.slug} />
    </PageMain>
  );
}
