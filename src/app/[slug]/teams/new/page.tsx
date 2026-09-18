import type { Metadata } from "next";
import Link from "next/link";
import { PlayerForm } from "@/components/teams/player-form";
import { SelfConfirm } from "@/components/teams/self-confirm";
import { TeamForm } from "@/components/teams/team-form";
import { Message } from "@/components/ui/message";
import { getDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { getPrincipal } from "@/lib/auth/principal";
import { checkAccess, resolveRole } from "@/lib/authz";
import { assertAccessOrDeny } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { findIndividualTeamOf } from "@/lib/repo/teams";
import { getMyPerson } from "@/lib/teams/self";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ kind?: string }> };

export const metadata: Metadata = { title: "登録" };

// チームで登録・個人で登録（設計書 §5.11「チームの作り方」「個人登録」）。ログインした人なら誰でも・承認なし
// 個人で登録: 本人の情報だけ。常に協会員の登録をする。1 協会 1 つ。すでに紐づいた人物があれば確認だけ
export default async function NewTeamPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { kind } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  const role = resolveRole(principal, null, { associationId: association.id });
  assertAccessOrDeny(checkAccess(role, "createTeam", principal));
  const userId = principal.userId as string;
  const individual = kind === "individual";

  const tabClass = (active: boolean) =>
    `flex min-h-12 items-center justify-center rounded-md border px-4 font-semibold no-underline ${
      active ? "border-primary bg-primary text-on-primary" : "border-border bg-background"
    }`;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{individual ? "個人で登録" : "チームで登録"}</h1>
      <nav aria-label="登録の種類" className="grid grid-cols-2 gap-2">
        <Link href={`/${association.slug}/teams/new`} aria-current={individual ? undefined : "page"} className={tabClass(!individual)}>
          チームで登録
        </Link>
        <Link href={`/${association.slug}/teams/new?kind=individual`} aria-current={individual ? "page" : undefined} className={tabClass(individual)}>
          個人で登録
        </Link>
      </nav>
      {individual ? <IndividualSection slug={association.slug} associationId={association.id} userId={userId} /> : <TeamSection slug={association.slug} />}
    </main>
  );
}

function TeamSection({ slug }: { slug: string }) {
  return (
    <>
      <p className="leading-relaxed">
        チーム名だけで登録できます。ほかの項目はあとから追加できます。登録したあなたが、このチームの代表者になります。
      </p>
      <TeamForm slug={slug} mode="create" initial={{ name: "", kana: "", contactEmail: "", contactPhone: "", membershipRenewalTarget: false }} />
    </>
  );
}

async function IndividualSection({ slug, associationId, userId }: { slug: string; associationId: string; userId: string }) {
  const principal = { ...(await getPrincipal()), userId };
  const [existing, person] = await Promise.all([
    withTenant(associationId, (tx) => findIndividualTeamOf(tx, associationId, userId), { userId }),
    getMyPerson(getDb(), principal, associationId),
  ]);
  if (existing) {
    return (
      <Message kind="info" title="個人の登録はすでにあります">
        <Link href={`/${slug}/teams/${existing.id}`} className="font-semibold underline underline-offset-2">
          あなたの登録情報を見る
        </Link>
      </Message>
    );
  }
  return (
    <>
      <p className="leading-relaxed">
        チームに所属していない方の登録です。あなたの情報だけで登録でき、協会員の登録（毎年の更新）の対象になります。大会に出るときは、チームを作るか、ほかのチームの申し込みに選手として入れてもらってください。
      </p>
      {person ? (
        <SelfConfirm
          person={person}
          url={`/api/${slug}/teams`}
          body={{ kind: "individual" }}
          successPath="/mypage"
          label="この内容で個人登録する"
        />
      ) : (
        <PlayerForm
          submit={{
            url: `/api/${slug}/teams`,
            method: "POST",
            extra: { kind: "individual" },
            successPath: "/mypage",
            label: "個人で登録する",
            pendingLabel: "登録しています…",
          }}
          initial={{ name: "", kana: "", birthDate: null, sex: "" }}
        />
      )}
    </>
  );
}
