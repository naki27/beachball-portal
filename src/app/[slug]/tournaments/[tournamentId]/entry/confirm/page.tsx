import type { Metadata } from "next";
import { ConflictScreen } from "@/components/conflict-screen";
import { EntryConfirm } from "@/components/entries/entry-confirm";
import { EntrySteps } from "@/components/entries/entry-steps";
import { PageHeader, PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { type EntryFormData, getEntryFormData } from "@/lib/entries/entry-form";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { TeamError } from "@/lib/teams/errors";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "申し込みの内容を確かめる" };

// 申込の確認ページ（設計書 §4.2 #7・§5.5「確認ページ」）
// 入力した内容は一時保存から読む（§4.3）。サーバーからは大会と部の名前・基準日だけを渡す
export default async function EntryConfirmPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();

  let data: EntryFormData;
  try {
    data = await getEntryFormData(getDb(), principal, association.id, tournamentId);
  } catch (error) {
    if (error instanceof TeamError && error.status === 409) {
      return (
        <PageMain>
          <ConflictScreen title={error.message} contactHref={`/${association.slug}/contact?tournament=${tournamentId}`}>
            <p>締切を過ぎてからの変更や申し込みは、問い合わせフォームからご連絡ください。</p>
          </ConflictScreen>
        </PageMain>
      );
    }
    pageErrorFrom(error);
  }

  return (
    <PageMain>
      <EntrySteps current="confirm" />
      <PageHeader eyebrow={data.tournament.name} title="この内容で申し込みます" />
      <EntryConfirm
        slug={association.slug}
        associationId={association.id}
        tournamentId={data.tournament.id}
        tournamentName={data.tournament.name}
        categories={data.categories.map((category) => ({
          id: category.id,
          label: category.label,
          referenceDate: category.ageReferenceDate,
        }))}
      />
    </PageMain>
  );
}
