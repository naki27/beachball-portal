import Link from "next/link";
import { OpenTournaments } from "@/components/top/open-tournaments";
import { RecentDocuments } from "@/components/top/recent-documents";
import { type TodoItem, YourTodos } from "@/components/top/your-todos";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { entryTodos, listMyEntries } from "@/lib/entries/my-entries";
import { loadAdminTeams, loadIndividualRegistration } from "@/lib/page/my-associations";
import { requireAssociation } from "@/lib/page/require-association";
import { listRecentDocumentsForPublic, listTournamentsForPublic } from "@/lib/public/tournaments";

type Props = { params: Promise<{ slug: string }> };

// 協会のトップ（設計書 §5.17「表示」）。タブの題名は layout の既定（協会名）
// ログイン中は「あなたのやること」をブロックの上に出す。ブロックは既定の並び（受付中の大会 → 今後の大会 → 新しい資料）
// やることは申込の分（B-16）。資料は 1c（C-03）、年度更新は 1d、並びのカスタマイズ（P1）は後のタスク
export default async function AssociationTop({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const now = new Date();
  const tournaments = await listTournamentsForPublic(getDb(), association.id, now);
  const documents = await listRecentDocumentsForPublic(getDb(), association.id);

  // ログイン中の人のやること（自分が代表を務めるチーム・個人登録について・§5.17）
  let todos: TodoItem[] = [];
  if (principal.userId) {
    const [entries, adminTeams, individual] = await Promise.all([
      listMyEntries(getDb(), principal, association.id),
      loadAdminTeams(principal, association.id),
      loadIndividualRegistration(principal, association.id),
    ]);
    todos = entryTodos(
      association.slug,
      tournaments.open.map((t) => ({ id: t.id, name: t.name })),
      entries.managed,
      adminTeams.length > 0 || individual !== null,
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-bold">{association.name}</h1>
      {principal.userId ? <YourTodos items={todos} /> : null}
      <OpenTournaments slug={association.slug} open={tournaments.open} upcoming={tournaments.upcoming} now={now} />
      <RecentDocuments slug={association.slug} documents={documents} />
      {principal.userId ? (
        <p>
          <Link href={`/${association.slug}/teams/new`} className="font-semibold underline underline-offset-2">
            チームを登録する
          </Link>
          {"　"}
          <Link href={`/${association.slug}/teams/new?kind=individual`} className="font-semibold underline underline-offset-2">
            個人で登録する
          </Link>
        </p>
      ) : null}
    </main>
  );
}
