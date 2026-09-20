import type { Metadata } from "next";
import Link from "next/link";
import { ContactList } from "@/components/contact/contact-list";
import { getDb } from "@/db/client";
import { listPlatformContacts } from "@/lib/contact-admin";
import { requirePlatformAdminPage } from "@/lib/page/platform";

type Props = { searchParams: Promise<{ status?: string }> };

export const metadata: Metadata = { title: "サイトへの問い合わせ" };

// サイトの運営者宛ての問い合わせ（設計書 §5.10）。運営管理者だけ
export default async function PlatformContactsPage({ searchParams }: Props) {
  await requirePlatformAdminPage();
  const { status } = await searchParams;
  const onlyNew = status !== "all";
  const rows = await listPlatformContacts(getDb(), onlyNew ? { status: "new" } : {});

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href="/platform" className="underline underline-offset-2">
          ← 運営管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">サイトへの問い合わせ</h1>
      <nav aria-label="絞り込み" className="flex gap-4 text-sm">
        <Link href="/platform/contacts" aria-current={onlyNew ? "page" : undefined} className={onlyNew ? "font-semibold" : "underline underline-offset-2"}>
          未対応
        </Link>
        <Link href="/platform/contacts?status=all" aria-current={onlyNew ? undefined : "page"} className={onlyNew ? "underline underline-offset-2" : "font-semibold"}>
          すべて
        </Link>
      </nav>
      <p className="text-sm text-muted">{rows.length} 件</p>
      <ContactList rows={rows} endpoint="/api/platform/contacts" />
    </main>
  );
}
