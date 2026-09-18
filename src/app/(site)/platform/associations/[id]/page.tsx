import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { associations } from "@/db/schema";
import { requirePlatformAdminPage } from "@/lib/page/platform";
import { listAdminInvitations } from "@/lib/platform/admin-invitations";
import { MAX_ADMINS_PER_ASSOCIATION } from "@/lib/platform/associations";
import { listAssociationAdmins, listAssociationStats } from "@/lib/repo/platform";
import { AdminManagement } from "./admin-management";
import { AssociationSettingsForm } from "./association-settings-form";
import { EnterTenantControls } from "./enter-tenant-controls";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "協会の設定" };

// 協会ごとの運営画面（§4.2 #24）。名前・スラッグの変更、テナント管理者の招待・解除、切り替えて入る
export default async function PlatformAssociationPage({ params }: Props) {
  const principal = await requirePlatformAdminPage();
  const { id } = await params;
  const db = getDb();
  const [association] = await db.select().from(associations).where(eq(associations.id, id)).limit(1);
  if (!association) notFound();

  const stats = (await listAssociationStats(db, principal.userId)).find((s) => s.associationId === id) ?? null;
  const admins = (await listAssociationAdmins(db, principal.userId)).filter((a) => a.associationId === id);
  const invitations = await listAdminInvitations(db, principal.userId, id);
  const entered = principal.enteredAssociationId === id;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-8">
      <p>
        <Link href="/platform" className="underline underline-offset-2">
          ← 運営管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{association.name}</h1>
      <p className="text-sm text-muted">
        <Link href={`/${association.slug}`} className="underline underline-offset-2">
          /{association.slug}
        </Link>
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">件数</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">チーム</dt>
          <dd>{stats?.teams ?? "—"}</dd>
          <dt className="text-muted">選手</dt>
          <dd>{stats?.members ?? "—"}</dd>
          <dt className="text-muted">受付中の大会</dt>
          <dd>{stats?.openTournaments ?? "—"}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">協会の管理者</h2>
        <AdminManagement
          associationId={id}
          admins={admins.map((a) => ({ userId: a.userId, email: a.email, displayName: a.displayName }))}
          invitations={invitations.map((i) => ({ id: i.id, email: i.email, status: i.status, expiresAt: i.expiresAt.toISOString() }))}
          pendingCount={stats?.pendingAdminInvitations ?? 0}
          maxAdmins={MAX_ADMINS_PER_ASSOCIATION}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">この協会の個人情報を見る</h2>
        <p className="text-sm leading-relaxed">
          選手やチームの情報を見るには、この協会に「切り替えて入る」必要があります（1 時間で自動的に出ます。誰がいつ入ったかは記録されます）。
        </p>
        <EnterTenantControls associationId={id} slug={association.slug} entered={entered} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">名前と URL</h2>
        <AssociationSettingsForm
          associationId={id}
          initial={{ name: association.name, slug: association.slug, contactEmail: association.contactEmail ?? "" }}
        />
      </section>
    </main>
  );
}
