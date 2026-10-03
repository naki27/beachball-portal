import { MarkdownView } from "@/components/legal/markdown-view";
import { PageMain } from "@/components/ui/layout";
import { type LegalSlug, readLegalDocument } from "@/lib/legal/documents";

// プライバシーポリシー・利用規約の画面（設計書 §5.18）。文面は docs/legal/*.md、版は TERMS_VERSION
export async function LegalPage({ slug }: { slug: LegalSlug }) {
  // 制定日・改定日・版は文面（docs/legal/*.md）の先頭に書く。版は TERMS_VERSION と同じ値にする（試験で確かめる）
  const blocks = await readLegalDocument(slug);
  return (
    <PageMain gap="sm">
      <MarkdownView blocks={blocks} />
    </PageMain>
  );
}
