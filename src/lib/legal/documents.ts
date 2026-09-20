import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Block, parseMarkdown } from "./markdown";
import { SITE_NAME } from "@/lib/site";

// プライバシーポリシー・利用規約（設計書 §5.18）。文面は docs/legal/*.md（人が直す。運営者の文面でテナントに属さない）
// 版は .env の TERMS_VERSION。アカウントを作るときに users.terms_version に保存する値と同じ

export type LegalSlug = "privacy" | "terms";

export const LEGAL_TITLE: Record<LegalSlug, string> = {
  privacy: "プライバシーポリシー",
  terms: "利用規約",
};

export function termsVersion(): string {
  return process.env.TERMS_VERSION?.trim() ?? "";
}

export function legalSource(markdown: string): string {
  return markdown.replaceAll("{{SITE_NAME}}", SITE_NAME);
}

export async function readLegalDocument(slug: LegalSlug): Promise<Block[]> {
  const file = path.join(process.cwd(), "docs", "legal", `${slug}.md`);
  return parseMarkdown(legalSource(await readFile(file, "utf8")));
}
