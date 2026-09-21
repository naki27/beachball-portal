import type { Metadata } from "next";
import Link from "next/link";
import { CategoryAddForm } from "@/components/tournaments/category-add-form";
import type { PresetRowView } from "@/components/tournaments/category-manager";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { type AdminCategoriesView, getCategoriesForAdmin } from "@/lib/admin/categories";
import { getPrincipal } from "@/lib/auth/principal";
import type { PlainDate } from "@/lib/date";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { categoryConditionText } from "@/lib/tournaments/category-text";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "部を追加する" };

// 大会に部を追加するページ（設計書 §5.4・§4.3「一覧と登録はページを分ける」）。テナント管理者だけ
export default async function NewTournamentCategoryPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const view = await getCategoriesForAdmin(
    getDb(),
    { ...principal, userId: principal.userId },
    association.id,
    tournamentId,
  ).catch(pageErrorFrom);
  const { tournament } = view;

  return (
    <PageMain width="wide">
      <p>
        <Link href={`/${association.slug}/admin/tournaments/${tournament.id}`} className="bb-link text-primary no-underline">
          ← {tournament.name}
        </Link>
      </p>
      <PageHeader eyebrow={tournament.name} title="部を追加する" lead="「よく使う部」から、この大会に出す部を選びます。" />
      <CategoryAddForm
        slug={association.slug}
        tournamentId={tournament.id}
        presets={view.presets.filter((p) => !p.added).map((p) => toPresetRow(p, tournament.ageReferenceDate))}
        presetSettingsUrl={`/${association.slug}/admin/association`}
      />
    </PageMain>
  );
}

function toPresetRow(p: AdminCategoriesView["presets"][number], referenceDate: PlainDate): PresetRowView {
  return { id: p.id, label: p.labelDefault, condition: categoryConditionText(p, referenceDate) };
}
