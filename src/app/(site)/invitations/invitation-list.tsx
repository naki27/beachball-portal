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
  inviterName: string | null;
  expiresAt: string;
};

// 招待の一覧と返事（§5.14）。文言は §4.4: 「◯◯協会の管理者として招待されています」
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
      const body = (await response.json().catch(() => null)) as { redirectTo?: string; error?: { message?: string } } | null;
      if (!response.ok) {
        setNotice({ kind: "error", title: body?.error?.message ?? "返事を送れませんでした" });
        return;
      }
      if (action === "accept") {
        setNotice({ kind: "success", title: `${invitation.associationName}の管理者になりました` });
        router.push(body?.redirectTo ?? `/${invitation.associationSlug}`);
        router.refresh();
      } else {
        setNotice({ kind: "info", title: "招待を無効にし、招待した人に知らせました" });
        router.refresh();
      }
    } catch {
      setNotice({ kind: "error", title: "返事を送れませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      <ul className="flex flex-col gap-4">
        {invitations.map((i) => {
          const until = formatDateWithWeekday(todayInTokyo(new Date(i.expiresAt)));
          const isAdmin = i.kind === "association_admin";
          return (
            <li key={i.invitationId} className="flex flex-col gap-3 rounded-md border border-border px-4 py-3">
              <p className="font-semibold">
                {isAdmin
                  ? `${i.associationName}の管理者として招待されています`
                  : `${i.teamName ?? i.associationName}から${i.kind === "admin" ? "代表者" : "選手"}として招待されています`}
              </p>
              <p className="text-sm text-muted">
                {i.inviterName ? `招待した人: ${i.inviterName}・` : ""}
                {until}まで
              </p>
              {isAdmin ? (
                <div className="flex flex-col gap-2">
                  <Button onClick={() => respond(i, "accept")} pending={pending === i.invitationId} pendingLabel="参加しています…">
                    参加する
                  </Button>
                  <Button variant="secondary" onClick={() => respond(i, "reject")} disabled={pending !== null}>
                    心当たりがない
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">選手・代表者としての招待への返事は、もう少しあとで使えるようになります</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
