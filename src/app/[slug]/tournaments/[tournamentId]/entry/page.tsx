import type { Metadata } from "next";
import Link from "next/link";
import { ConflictScreen } from "@/components/conflict-screen";
import { EntryForm, type EntryFormCategoryView } from "@/components/entries/entry-form";
import { EntrySteps } from "@/components/entries/entry-steps";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { type EntryFormData, getEntryFormData } from "@/lib/entries/entry-form";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { TeamError } from "@/lib/teams/errors";
import { deadlineText } from "@/lib/tournaments/deadline-text";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

export const metadata: Metadata = { title: "大会に申し込む" };

// 大会申込の入力ページ（設計書 §4.2 #7・§5.5）
// ログインした人なら開ける（そのチームの代表者かは送信時に検査する・§5.5 v0.9）。未ログインは 403（リダイレクトしない）
// 締切後・受付前は 409 の画面（問い合わせの導線つき）。テナント管理者は締切後でも開ける（§3.2）
export default async function EntryPage({ params }: Props) {
  const { slug, tournamentId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();

  const now = new Date();
  let data: EntryFormData;
  try {
    data = await getEntryFormData(getDb(), principal, association.id, tournamentId, now);
  } catch (error) {
    // 締切後・受付前は 409。問い合わせフォームへ案内する（§5.5d）
    if (error instanceof TeamError && error.status === 409) {
      return (
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
          <ConflictScreen title={error.message} contactHref={`/${association.slug}/contact?tournament=${tournamentId}`}>
            <p>締切を過ぎてからの変更や申し込みは、問い合わせフォームからご連絡ください。</p>
          </ConflictScreen>
        </main>
      );
    }
    pageErrorFrom(error);
  }

  const { tournament } = data;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/tournaments/${tournament.id}`} className="underline underline-offset-2">
          ← {tournament.name}
        </Link>
      </p>
      <EntrySteps current="input" />
      <h1 className="text-2xl font-bold break-words">{tournament.name}に申し込む</h1>
      {data.isAssociationAdmin ? (
        <Message kind="info" title="協会の管理者として開いています">
          <p>締切を過ぎた部にも申し込めます。</p>
        </Message>
      ) : null}
      <EntryForm
        slug={association.slug}
        associationId={association.id}
        tournamentId={tournament.id}
        teams={data.teams}
        categories={data.categories.map((category) => toCategoryView(category, now))}
        rosters={data.rosters}
        teamSizeMin={data.teamSizeMin}
        teamSizeMax={data.teamSizeMax}
        year={data.year}
        showMembersOnly={data.showMembersOnly}
        token={data.token}
      />
    </main>
  );
}

function toCategoryView(category: EntryFormData["categories"][number], now: Date): EntryFormCategoryView {
  return {
    id: category.id,
    label: category.label,
    condition: category.condition,
    deadline: deadlineText(category.entryEndAt, now),
    selectable: category.selectable,
    // 選べない部は、理由を選択肢の中に出す（内部の値は出さない・§4.4）
    note: category.selectable ? null : category.state === "not_started" ? "受付前" : "締切",
    preset: category.preset,
    referenceDate: category.ageReferenceDate,
  };
}
