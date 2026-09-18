import type { Metadata } from "next";
import Link from "next/link";
import { PlayerForm } from "@/components/teams/player-form";
import { SelfConfirm } from "@/components/teams/self-confirm";
import { getDb } from "@/db/client";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { TeamError } from "@/lib/teams/errors";
import { getRoster } from "@/lib/teams/roster";
import { getMyPerson } from "@/lib/teams/self";

type Props = { params: Promise<{ slug: string; teamId: string }>; searchParams: Promise<{ self?: string }> };

export const metadata: Metadata = { title: "選手の追加" };

// 選手の追加（設計書 §5.11「名簿の管理」）。代表者だけ。本人の情報を入力する（同意の文言・§5.18）
// ?self=1 は「自分を選手として登録する」: 自分の人物を加え、招待を挟まずに自分のアカウントに紐づける
export default async function NewPlayerPage({ params, searchParams }: Props) {
  const { slug, teamId } = await params;
  const { self } = await searchParams;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const me = { ...principal, userId: principal.userId };
  const roster = await getRoster(getDb(), me, association.id, teamId).catch(pageErrorFrom);
  if (!roster.canManage) pageErrorFrom(new TeamError(403, "チームの代表者だけができます"));
  const membersPath = `/${association.slug}/teams/${roster.team.id}/members`;
  const alreadyIn = roster.items.some((i) => i.isSelf);

  if (self === "1") {
    const person = await getMyPerson(getDb(), me, association.id);
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
        <p>
          <Link href={membersPath} className="underline underline-offset-2">
            ← 選手一覧
          </Link>
        </p>
        <h1 className="text-2xl font-bold">自分を選手として登録する</h1>
        {alreadyIn ? (
          <p className="leading-relaxed">あなたはすでにこの選手一覧にいます。</p>
        ) : person ? (
          <SelfConfirm
            person={person}
            url={`/api/${association.slug}/teams/${roster.team.id}/members`}
            body={{ self: true }}
            successPath={`${membersPath}?added=1`}
            label="選手一覧に追加する"
          />
        ) : (
          <>
            <p className="leading-relaxed">あなたの情報を入力してください。選手一覧に加え、ログイン中のアカウントに結びつけます。</p>
            <PlayerForm
              submit={{
                url: `/api/${association.slug}/teams/${roster.team.id}/members`,
                method: "POST",
                extra: { self: true },
                successPath: `${membersPath}?added=1`,
                label: "選手一覧に追加する",
                pendingLabel: "追加しています…",
              }}
              initial={{ name: "", kana: "", birthDate: null, sex: "" }}
            />
          </>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={membersPath} className="underline underline-offset-2">
          ← 選手一覧
        </Link>
      </p>
      <h1 className="text-2xl font-bold">選手の追加</h1>
      {!alreadyIn ? (
        <p>
          <Link href={`${membersPath}/new?self=1`} className="font-semibold underline underline-offset-2">
            自分を選手として登録する
          </Link>
        </p>
      ) : null}
      <p className="rounded-md border border-border bg-info-surface px-4 py-3 leading-relaxed">
        ご本人（未成年の方は保護者）の同意を得て入力してください
      </p>
      <PlayerForm
        submit={{
          url: `/api/${association.slug}/teams/${roster.team.id}/members`,
          method: "POST",
          successPath: `${membersPath}?added=1`,
          label: "選手一覧に追加する",
          pendingLabel: "追加しています…",
        }}
        initial={{ name: "", kana: "", birthDate: null, sex: "" }}
      />
    </main>
  );
}
