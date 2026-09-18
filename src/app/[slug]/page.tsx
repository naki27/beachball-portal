import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }> };

// 協会のトップ（仮）。大会一覧・「あなたのやること」は B-06・A-13 で作る。タブの題名は layout の既定（協会名）
export default async function AssociationTop({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{association.name}</h1>
      <p className="leading-relaxed">準備中です。大会の申し込みは、このページからできるようになります。</p>
    </main>
  );
}
