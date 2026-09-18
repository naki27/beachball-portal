import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { associations } from "@/db/schema";
import { requirePlatformAdminPage } from "@/lib/page/platform";
import { listAssociationStats } from "@/lib/repo/platform";
import { CreateAssociationForm } from "./create-association-form";

export const metadata: Metadata = { title: "運営管理" };

// 運営管理（設計書 §4.2 #24・§5.14「運営管理者」）。全テナントの一覧と件数だけ。個人情報は出さない
export default async function PlatformHome() {
  const principal = await requirePlatformAdminPage();
  const db = getDb();
  const rows = await db.select().from(associations).orderBy(associations.createdAt);
  const stats = new Map((await listAssociationStats(db, principal.userId)).map((s) => [s.associationId, s]));

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-bold">運営管理</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">協会の一覧</h2>
        <ul className="flex flex-col gap-3">
          {rows.map((a) => {
            const s = stats.get(a.id);
            return (
              <li key={a.id} className="rounded-md border border-border px-4 py-3">
                <Link href={`/platform/associations/${a.id}`} className="text-lg font-semibold underline underline-offset-2">
                  {a.name}
                </Link>
                <p className="text-sm text-muted">
                  /{a.slug}
                  {a.status !== "active" ? `・${a.status}` : ""}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted">チーム</dt>
                  <dd>{s?.teams ?? "—"}</dd>
                  <dt className="text-muted">選手</dt>
                  <dd>{s?.members ?? "—"}</dd>
                  <dt className="text-muted">受付中の大会</dt>
                  <dd>{s?.openTournaments ?? "—"}</dd>
                  <dt className="text-muted">協会の管理者</dt>
                  <dd>
                    {s?.admins ?? "—"} 名{s && s.pendingAdminInvitations > 0 ? `（返事待ちの招待 ${s.pendingAdminInvitations}）` : ""}
                  </dd>
                </dl>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">協会を作る</h2>
        <CreateAssociationForm />
      </section>
    </main>
  );
}
