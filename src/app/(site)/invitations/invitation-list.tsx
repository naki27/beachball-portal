"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";

export type InvitationItem = {
  invitationId: string;
  associationName: string;
  associationSlug: string;
  teamName: string | null;
  kind: string;
  memberName: string | null;
  inviterName: string | null;
  expiresAt: string;
};

// 招待の一覧と返事（§5.14・§5.15）。文言は §4.4:
// 「◯◯協会の管理者として招待されています」「◯◯チームから選手（山田太郎）として招待されています」「◯◯チームから代表者として招待されています」
export function InvitationList({ invitations }: { invitations: InvitationItem[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; title: string } | null>(null);

  async function respond(invitation: InvitationItem, action: "accept" | "reject") {
    if (pending) return;
    setPending(invitation.invitationId);
    setNotice(null);
    try {
      const response = await fetch(`/api/me/invitations/${invitation.invitationId}/${action}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { redirectTo?: string; message?: string; error?: { message?: string } } | null;
      if (!response.ok) {
        setNotice({ kind: "error", title: body?.error?.message ?? "返事を送れませんでした" });
        return;
      }
      if (action === "accept") {
        setNotice({ kind: "success", title: body?.message ?? "参加しました" });
        router.push(body?.redirectTo ?? `/${invitation.associationSlug}`);
        router.refresh();
      } else {
        setNotice({ kind: "info", title: body?.message ?? "招待を無効にし、招待した人に知らせました" });
        router.refresh();
      }
    } catch {
      setNotice({ kind: "error", title: "返事を送れませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(null);
    }
  }

  function titleOf(i: InvitationItem): string {
    if (i.kind === "association_admin") return `${i.associationName}の管理者として招待されています`;
    const team = i.teamName ?? i.associationName;
    if (i.kind === "admin") return `${team}から代表者として招待されています`;
    return `${team}から選手${i.memberName ? `（${i.memberName}）` : ""}として招待されています`;
  }

  return (
    <div className="flex flex-col gap-4" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      <ul className="flex flex-col gap-4">
        {invitations.map((i) => {
          const until = formatDateWithWeekday(todayInTokyo(new Date(i.expiresAt)));
          return (
            <li key={i.invitationId} className="flex flex-col gap-3 rounded-md border border-border px-4 py-3">
              <p className="font-semibold">{titleOf(i)}</p>
              <p className="text-sm text-muted">
                {i.kind !== "association_admin" ? `${i.associationName}・` : ""}
                {i.inviterName ? `招待した人: ${i.inviterName}・` : ""}
                {until}まで
              </p>
              <div className="flex flex-col gap-2">
                <Button onClick={() => respond(i, "accept")} pending={pending === i.invitationId} pendingLabel="参加しています…">
                  参加する
                </Button>
                <Button variant="secondary" onClick={() => respond(i, "reject")} disabled={pending !== null}>
                  心当たりがない
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
