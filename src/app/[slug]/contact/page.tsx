import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/contact-form";
import { PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { getPrincipal } from "@/lib/auth/principal";
import { requireAssociation } from "@/lib/page/require-association";
import { and, eq, isNull } from "drizzle-orm";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ entryId?: string }> };

// 題名は協会の layout の template（｜協会名）が付ける
export const metadata: Metadata = { title: "お問い合わせ" };

// 協会宛ての問い合わせ（設計書 §5.10）。宛先はこの協会。ログインしていれば氏名とメールを補う
export default async function AssociationContactPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { entryId } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const profile = principal.userId
    ? (await getDb().select({ displayName: users.displayName, email: users.email }).from(users).where(and(eq(users.id, principal.userId), isNull(users.deletedAt))).limit(1))[0]
    : undefined;

  return (
    <PageMain>
      <h1 className="text-2xl font-bold">{association.name}へのお問い合わせ</h1>
      <p className="leading-relaxed">ログインできないときも、こちらから送れます。お電話の窓口はありません。</p>
      <ContactForm
        initialName={profile?.displayName ?? ""}
        initialEmail={profile?.email ?? ""}
        associationId={association.id}
        entryId={entryId ?? null}
      />
    </PageMain>
  );
}
