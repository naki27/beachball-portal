import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL_TITLE } from "@/lib/legal/documents";

export const metadata: Metadata = { title: LEGAL_TITLE.terms };

// 利用規約（設計書 §5.18）。未ログインでも開ける。テナントに属さない（運営者の文面）
export default async function TermsPage() {
  return <LegalPage slug="terms" />;
}
