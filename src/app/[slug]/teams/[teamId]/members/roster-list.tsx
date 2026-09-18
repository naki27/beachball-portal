"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { UndoBar } from "@/components/ui/undo-bar";
import { useHydrated } from "@/hooks/use-hydrated";
import { parsePlainDate } from "@/lib/date";
import { SEX_LABEL } from "@/lib/teams/player-input";
import type { Roster } from "@/lib/teams/roster";
import { formatBirthDateLong } from "@/lib/wareki";

// 選手一覧（設計書 §5.11）。選手 1 人 = 1 カード。代表者には「修正する」「選手一覧から外す」、
// 外した直後は「◯◯さんを外しました［元に戻す］」（外した本人・30 分以内。表示はサーバーが決める）
export function RosterList({ slug, roster, viewerCanManage }: { slug: string; roster: Roster; viewerCanManage: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(teamMemberId: string, action: "leave" | "undo-leave") {
    if (pending) return;
    setPending(teamMemberId);
    setNotice(null);
    try {
      const response = await fetch(`/api/${slug}/teams/${roster.team.id}/members/${teamMemberId}/${action}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) setNotice(body?.error?.message ?? "できませんでした");
      router.refresh();
    } catch {
      setNotice("できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind="error" title={notice} /> : null}
      {roster.recentlyLeft.map((r) => (
        <UndoBar
          key={r.teamMemberId}
          message={`${r.name}さんを外しました`}
          onUndo={() => call(r.teamMemberId, "undo-leave")}
          pending={pending === r.teamMemberId}
        />
      ))}
      {roster.items.length === 0 ? (
        <p className="leading-relaxed text-muted">まだ選手がいません。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {roster.items.map((item) => {
            const birth = item.personal ? parsePlainDate(item.personal.birthDate) : null;
            return (
              <li key={item.teamMemberId} className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-lg font-semibold break-words">
                    {item.name}
                    {item.isSelf ? <span className="ml-2 text-sm font-normal text-muted">（あなた）</span> : null}
                  </span>
                  {item.kana ? <span className="text-sm text-muted">{item.kana}</span> : null}
                </div>
                {item.personal && birth ? (
                  <p className="text-sm">
                    {formatBirthDateLong(birth)}・{item.personal.age}歳・{SEX_LABEL[item.personal.sex]}
                  </p>
                ) : null}
                {item.isSelf && !viewerCanManage ? (
                  <p className="text-sm text-muted">情報の修正はチームの代表者だけができます。代表者に直接お伝えください</p>
                ) : null}
                {viewerCanManage ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link
                      href={`/${slug}/teams/${roster.team.id}/members/${item.teamMemberId}/edit`}
                      className="inline-flex min-h-10 items-center font-semibold underline underline-offset-2"
                    >
                      修正する
                    </Link>
                    <Button
                      variant="secondary"
                      className="min-h-10"
                      onClick={() => call(item.teamMemberId, "leave")}
                      pending={pending === item.teamMemberId}
                      pendingLabel="外しています…"
                    >
                      選手一覧から外す
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
