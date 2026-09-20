import { and, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/contact-form";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { getPrincipal } from "@/lib/auth/principal";
import { listAllAssociations, listMyAssociations } from "@/lib/repo/associations";

export const metadata: Metadata = { title: "お問い合わせ" };

// 協会に属さない問い合わせの入口（設計書 §5.10）。宛先を選んでもらう
// 選べる協会は「役割を持つ協会」。役割がなければ全協会
export default async function ContactPage() {
  const db = getDb();
  const principal = await getPrincipal();
  const mine = principal.userId ? await listMyAssociations(db, principal.userId) : [];
  const [associationOptions, profile] = await Promise.all([
    mine.length > 0 ? Promise.resolve(mine) : listAllAssociations(db),
    principal.userId
      ? db
          .select({ displayName: users.displayName, email: users.email })
          .from(users)
          .where(and(eq(users.id, principal.userId), isNull(users.deletedAt)))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const user = profile[0];

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">お問い合わせ</h1>
      <p className="leading-relaxed">ログインできないときも、こちらから送れます。</p>
      <ContactForm
        initialName={user?.displayName ?? ""}
        initialEmail={user?.email ?? ""}
        associations={associationOptions.map((a) => ({ id: a.id, name: a.name }))}
      />
    </main>
  );
}
