"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";

// 年度更新の承認（設計書 §4.2 #17・§5.12）。テナント管理者だけ
// 通常の申告と「追加の申告」を分けて出す。追加の申告は、承認を省く年度でも承認が要る

export type PendingTeamView = {
  teamId: string | null;
  teamName: string;
  players: { memberId: string; name: string }[];
};

export type UndeclaredTeamView = { teamId: string; teamName: string; players: number };

export function ApprovalList({
  slug,
  year,
  pending,
  additional,
  undeclared,
  approvedCount,
}: {
  slug: string;
  year: number;
  pending: PendingTeamView[];
  additional: PendingTeamView[];
  undeclared: UndeclaredTeamView[];
  approvedCount: number;
}) {
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  async function approve(key: string, memberIds: string[], label: string): Promise<void> {
    if (pendingKey || memberIds.length === 0) return;
    setNotice(null);
    setDone(null);
    setPendingKey(key);
    try {
      const response = await fetch(`/api/${slug}/admin/memberships/${year}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberIds }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; approved?: number; error?: { message?: string } } | null;
      if (response.ok) {
        setDone(`${label}（${body?.approved ?? 0}人）を承認しました`);
        router.refresh();
        return;
      }
      setNotice(body?.error?.message ?? "承認できませんでした");
    } catch {
      setNotice("承認できませんでした。電波の状態を確かめてください");
    } finally {
      setPendingKey(null);
    }
  }

  const allPending = [...pending, ...additional].flatMap((team) => team.players.map((player) => player.memberId));

  return (
    <section className="flex flex-col gap-4">
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      <p className="text-sm text-muted">
        {year}年度の協会員: 承認済み {approvedCount} 人・承認待ち {allPending.length} 人
      </p>

      {allPending.length > 0 ? (
        <Button
          pending={pendingKey === "all"}
          pendingLabel="承認しています…"
          onClick={() => void approve("all", allPending, "承認待ちのすべて")}
          fullWidth
        >
          承認待ちのすべて（{allPending.length}人）を承認する
        </Button>
      ) : null}

      <Group
        title="承認待ちの申告"
        empty="承認待ちの申告はありません。"
        teams={pending}
        slug={slug}
        pendingKey={pendingKey}
        onApprove={approve}
      />
      <Group
        title="追加の申告"
        empty="追加の申告はありません。"
        note="年度の途中に届いた申告です。承認を省く年度でも、承認が必要です。"
        teams={additional}
        slug={slug}
        pendingKey={pendingKey}
        onApprove={approve}
      />

      <section aria-labelledby="undeclared" className="flex flex-col gap-2">
        <h3 id="undeclared" className="font-bold">
          未申告のチーム（{undeclared.length}組）
        </h3>
        <p className="text-sm text-muted">協会員の登録をするチームのうち、まだ申告が届いていないものです。督促のメールは、いまは送れません。</p>
        <ul className="flex flex-col gap-2">
          {undeclared.map((team) => (
            <li key={team.teamId} className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
              <span>
                <Link href={`/${slug}/admin/teams/${team.teamId}`} className="font-semibold underline underline-offset-2">
                  {team.teamName}
                </Link>
                <span className="text-sm text-muted">（選手 {team.players} 人）</span>
              </span>
              <Link href={`/${slug}/teams/${team.teamId}/membership`} className="text-sm underline underline-offset-2">
                代理で申告する
              </Link>
            </li>
          ))}
          {undeclared.length === 0 ? <li className="text-muted">未申告のチームはありません。</li> : null}
        </ul>
      </section>
    </section>
  );
}

function Group({
  title,
  empty,
  note,
  teams,
  slug,
  pendingKey,
  onApprove,
}: {
  title: string;
  empty: string;
  note?: string;
  teams: PendingTeamView[];
  slug: string;
  pendingKey: string | null;
  onApprove: (key: string, memberIds: string[], label: string) => Promise<void>;
}) {
  return (
    <section aria-labelledby={`group-${title}`} className="flex flex-col gap-2">
      <h3 id={`group-${title}`} className="font-bold">
        {title}（{teams.reduce((total, team) => total + team.players.length, 0)}人）
      </h3>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      <ul className="flex flex-col gap-3">
        {teams.map((team) => (
          <li key={team.teamId ?? "none"} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="font-semibold break-words">
              {team.teamId ? (
                <Link href={`/${slug}/admin/teams/${team.teamId}`} className="underline underline-offset-2">
                  {team.teamName}
                </Link>
              ) : (
                team.teamName
              )}
            </p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {team.players.map((player) => (
                <li key={player.memberId} className="break-words">
                  {player.name}
                </li>
              ))}
            </ul>
            <div>
              <Button
                variant="secondary"
                pending={pendingKey === `team:${team.teamId}`}
                pendingLabel="承認しています…"
                onClick={() => void onApprove(`team:${team.teamId}`, team.players.map((player) => player.memberId), team.teamName)}
              >
                このチームをまとめて承認する
              </Button>
            </div>
          </li>
        ))}
        {teams.length === 0 ? <li className="text-muted">{empty}</li> : null}
      </ul>
    </section>
  );
}
