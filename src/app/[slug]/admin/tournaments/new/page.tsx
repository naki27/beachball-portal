import type { Metadata } from "next";
import Link from "next/link";
import { EMPTY_TOURNAMENT, TournamentForm } from "@/components/tournaments/tournament-form";
import { PageMain } from "@/components/ui/layout";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";

type Props = { params: Promise<{ slug: string }> };

export const metadata: Metadata = { title: "大会を作る" };

// 大会を作る（設計書 §5.4）。テナント管理者だけ。部の追加は作ったあとの画面から（B-05）
export default async function NewTournamentPage({ params }: Props) {
  const { slug } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "manageTournaments", principal));

  return (
    <PageMain>
      <p>
        <Link href={`/${association.slug}/admin/tournaments`} className="underline underline-offset-2">
          ← 大会の管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">大会を作る</h1>
      <p className="leading-relaxed">
        「準備中」で作ると、まだ誰にも見えません。出場する部を追加してから「受付中」にしてください。
      </p>
      <TournamentForm slug={association.slug} mode="create" initial={EMPTY_TOURNAMENT} />
    </PageMain>
  );
}
