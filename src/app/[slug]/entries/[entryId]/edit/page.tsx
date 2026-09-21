import type { Metadata } from "next";
import Link from "next/link";
import { ConflictScreen } from "@/components/conflict-screen";
import { EntryEditForm } from "@/components/entries/entry-edit-form";
import type { EntryFormCategoryView } from "@/components/entries/entry-form";
import { PageMain } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { type EntryEditData, getEntryEditData } from "@/lib/entries/entry-edit";
import type { EntryFormData } from "@/lib/entries/entry-form";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { TeamError } from "@/lib/teams/errors";
import { deadlineText } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string; entryId: string }> };

export const metadata: Metadata = { title: "申し込みの内容を変える" };

// 申込の変更（設計書 §5.5(d)）。締切までは代表者が何度でも直せる。締切後は 409 の画面（問い合わせの導線つき）
// テナント管理者は締切後も直せる（§3.2）。変更の記録は entry_audits に残る
export default async function EntryEditPage({ params }: Props) {
  const { slug, entryId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();

  const now = new Date();
  let data: EntryEditData;
  try {
    data = await getEntryEditData(getDb(), principal, association.id, entryId, now);
  } catch (error) {
    if (error instanceof TeamError && error.status === 409) {
      return (
        <PageMain>
          <ConflictScreen title={error.message} contactHref={`/${association.slug}/contact`}>
            <p>締切を過ぎてからの変更や取り消しは、問い合わせフォームからご連絡ください。</p>
          </ConflictScreen>
        </PageMain>
      );
    }
    pageErrorFrom(error);
  }

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/entries/${data.entryId}`} className="underline underline-offset-2">
          ← 申し込みの内容へ
        </Link>
      </p>
      <h1 className="text-2xl font-bold break-words">{data.tournament.name}の申し込みを変える</h1>
      {data.isAssociationAdmin ? (
        <Message kind="info" title="協会の管理者として開いています">
          <p>締切を過ぎた申し込みも変えられます。変更した記録が残ります。</p>
        </Message>
      ) : null}
      <EntryEditForm
        slug={association.slug}
        entryId={data.entryId}
        categories={data.categories.map((category) => toCategoryView(category, now))}
        roster={data.roster}
        initialSlots={data.slots}
        initialCategoryId={data.categoryId}
        initialTeamName={data.teamName}
        initialNote={data.note}
        missingMemberIds={data.missingMemberIds}
        teamSizeMin={data.teamSizeMin}
        teamSizeMax={data.teamSizeMax}
        year={data.year}
        showMembersOnly={data.showMembersOnly}
      />
    </PageMain>
  );
}

function toCategoryView(category: EntryFormData["categories"][number], now: Date): EntryFormCategoryView {
  return {
    id: category.id,
    code: category.code,
    label: category.label,
    condition: category.condition,
    deadline: deadlineText(category.entryEndAt, now),
    selectable: category.selectable,
    note: category.selectable ? null : category.state === "not_started" ? "受付前" : "締切",
    preset: category.preset,
    referenceDate: category.ageReferenceDate,
  };
}
