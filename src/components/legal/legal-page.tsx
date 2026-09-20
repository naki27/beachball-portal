import { MarkdownView } from "@/components/legal/markdown-view";
import { type LegalSlug, readLegalDocument } from "@/lib/legal/documents";

// プライバシーポリシー・利用規約の画面（設計書 §5.18）。文面は docs/legal/*.md、版は TERMS_VERSION
export async function LegalPage({ slug }: { slug: LegalSlug }) {
  // 制定日・改定日・版は文面（docs/legal/*.md）の先頭に書く。版は TERMS_VERSION と同じ値にする（試験で確かめる）
  const blocks = await readLegalDocument(slug);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-8">
      <MarkdownView blocks={blocks} />
    </main>
  );
}
