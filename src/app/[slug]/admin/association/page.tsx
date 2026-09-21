import type { Metadata } from "next";
import Link from "next/link";
import { PresetManager, type PresetRow } from "@/components/tournaments/preset-manager";
import { PageHeader, PageMain, Section } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { type AdminPresetRow, listPresetsForAdmin } from "@/lib/admin/category-presets";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ added?: string }> };

export const metadata: Metadata = { title: "協会の設定" };

// 協会の設定（設計書 §5.4「プリセットはテナント設定画面から管理者が編集できる」）。テナント管理者だけ
// いまは「よく使う部」だけ。色・連絡先などの設定は後のタスク
export default async function AdminAssociationPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { added } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const presets = await listPresetsForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id).catch(pageErrorFrom);

  return (
    <PageMain width="wide" gap="lg">
      <p>
        <Link href={`/${association.slug}/admin`} className="bb-link text-primary">
          ← 管理
        </Link>
      </p>
      <PageHeader title="協会の設定" />
      <Section id="presets" title="よく使う部">
        <PresetManager slug={association.slug} presets={presets.map(toPresetRow)} addedId={added ?? null} />
      </Section>
    </PageMain>
  );
}

// 画面が扱う値はすべて文字列（数は入力欄の形に合わせる）
function toPresetRow(p: AdminPresetRow): PresetRow {
  return {
    id: p.id,
    code: p.code,
    labelDefault: p.labelDefault,
    gender: p.gender,
    ruleType: p.ruleType,
    ruleValue: p.ruleValue === null ? "" : String(p.ruleValue),
    courtSize: String(p.courtSize),
    mixedMinMale: String(p.mixedMinMale),
    mixedMinFemale: String(p.mixedMinFemale),
    sortOrder: String(p.sortOrder),
    isActive: p.isActive,
    usedBy: p.usedBy,
  };
}
