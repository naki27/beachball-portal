import { OpenTournaments } from "@/components/top/open-tournaments";
import { type TodoItem, YourTodos } from "@/components/top/your-todos";
import { getPrincipal } from "@/lib/auth/principal";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }> };

// 協会のトップ（設計書 §5.17「表示」）。タブの題名は layout の既定（協会名）
// ログイン中は「あなたのやること」をブロックの上に出す。ブロックは既定の並び（受付中の大会 → 今後の大会 → 新しい資料）
// 今は骨組み: やることの中身・大会の一覧は B-06、今後の大会・資料・並びのカスタマイズ（P1）は後のタスク
export default async function AssociationTop({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  // ログイン中の人のやること（自分が代表を務めるチーム・個人登録について）。中身は B-06・D 系のタスクで足す
  const todos: TodoItem[] = [];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-bold">{association.name}</h1>
      {principal.userId ? <YourTodos items={todos} /> : null}
      <OpenTournaments />
    </main>
  );
}
