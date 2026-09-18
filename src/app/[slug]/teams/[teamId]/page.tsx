import type { Metadata } from "next";
import Link from "next/link";
import { Message } from "@/components/ui/message";
import { can } from "@/lib/authz";
import { requireAssociation } from "@/lib/page/require-association";
import { requireTeam } from "@/lib/page/require-team";

type Props = {
  params: Promise<{ slug: string; teamId: string }>;
  searchParams: Promise<{ created?: string; updated?: string }>;
};

export const metadata: Metadata = { title: "チーム" };

// チームのページ（骨組み・設計書 §5.11）。チームの選手・代表者・テナント管理者が見られる（§3.2）
// 連絡先は代表者から。選手一覧は A-17、申込は B 系のタスクで足す
export default async function TeamPage({ params, searchParams }: Props) {
  const { slug, teamId } = await params;
  const { created, updated } = await searchParams;
  const association = await requireAssociation(slug);
  const { team, role } = await requireTeam(association, teamId, "viewOwnTeamRoster");
  const canEdit = can(role, "editTeam");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      {created === "1" ? <Message kind="success" title="チームを登録しました。あなたがこのチームの代表者です" /> : null}
      {updated === "1" ? <Message kind="success" title="チーム情報を保存しました" /> : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold break-words">{team.name}</h1>
        {team.kana ? <p className="text-sm text-muted">{team.kana}</p> : null}
      </div>

      <p>
        <Link
          href={`/${association.slug}/teams/${team.id}/members`}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-border px-4 font-semibold no-underline"
        >
          選手一覧
        </Link>
      </p>

      <section aria-labelledby="team-info" className="flex flex-col gap-3">
        <h2 id="team-info" className="text-lg font-bold">
          チーム情報
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted">協会員の登録</dt>
          <dd>{team.membershipRenewalTarget ? "するチーム" : "しないチーム"}</dd>
          {can(role, "viewTeamContact") ? (
            <>
              <dt className="text-muted">メール</dt>
              <dd className="break-all">{team.contactEmail ?? "未登録"}</dd>
              <dt className="text-muted">電話</dt>
              <dd>{team.contactPhone ?? "未登録"}</dd>
            </>
          ) : null}
        </dl>
        {canEdit ? (
          <p>
            <Link href={`/${association.slug}/teams/${team.id}/edit`} className="font-semibold underline underline-offset-2">
              チーム情報を変える
            </Link>
          </p>
        ) : null}
      </section>
    </main>
  );
}
