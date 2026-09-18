"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { UndoBar } from "@/components/ui/undo-bar";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatDateWithWeekday, parsePlainDate, todayInTokyo } from "@/lib/date";
import { SEX_LABEL } from "@/lib/teams/player-input";
import type { Roster, RosterItem } from "@/lib/teams/roster";
import { formatBirthDateLong } from "@/lib/wareki";

type Notice = { kind: "success" | "error" | "info"; title: string };

// 選手一覧（設計書 §5.11）。選手 1 人 = 1 カード。代表者には「修正する」「選手一覧から外す」「招待する」、
// 外した直後は「◯◯さんを外しました［元に戻す］」（外した本人・30 分以内。表示はサーバーが決める）
// 招待（§5.15）: 本人のメールアドレスを入れて送る → 「招待中（◯月◯日まで）」＋ もう一度送る／取り消す。紐づけば「本人がログインできます」
export function RosterList({ slug, roster, viewerCanManage }: { slug: string; roster: Roster; viewerCanManage: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const base = `/api/${slug}/teams/${roster.team.id}`;

  async function call(key: string, url: string, init: RequestInit, onOk?: (body: Record<string, unknown> | null) => void) {
    if (pending) return;
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => null)) as (Record<string, unknown> & { error?: { message?: string } }) | null;
      if (!response.ok) {
        setNotice({ kind: "error", title: body?.error?.message ?? "できませんでした" });
        return false;
      }
      onOk?.(body);
      router.refresh();
      return true;
    } catch {
      setNotice({ kind: "error", title: "できませんでした。電波の状態を確かめてください" });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function sendInvitation(event: FormEvent, item: RosterItem) {
    event.preventDefault();
    if (!inviteEmail.includes("@")) {
      setInviteError("メールアドレスの形で入力してください");
      return;
    }
    setInviteError(null);
    const ok = await call(`invite:${item.teamMemberId}`, `${base}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memberId: item.memberId, email: inviteEmail }),
    });
    if (ok) {
      setNotice({ kind: "success", title: `${item.name}さんに招待のメールを送ります` });
      setInviting(null);
      setInviteEmail("");
    }
  }

  function accountLine(item: RosterItem) {
    if (!item.account || roster.team.kind !== "team") return null;
    if (item.account.linked) return <p className="text-sm text-muted">本人がログインできます</p>;
    const inv = item.account.invitation;
    if (inv) {
      const until = formatDateWithWeekday(todayInTokyo(new Date(inv.expiresAt)));
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {inv.expired ? "招待の期限が切れました" : `招待中（${until}まで）`}・<span className="break-all">{inv.email}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="min-h-10"
              onClick={() =>
                void call(`resend:${inv.invitationId}`, `${base}/invitations/${inv.invitationId}/resend`, { method: "POST" }, () =>
                  setNotice({ kind: "success", title: `${item.name}さんに招待のメールをもう一度送ります` }),
                )
              }
              pending={pending === `resend:${inv.invitationId}`}
              pendingLabel="送っています…"
            >
              もう一度送る
            </Button>
            <Button
              variant="secondary"
              className="min-h-10"
              onClick={() =>
                void call(`cancel:${inv.invitationId}`, `${base}/invitations/${inv.invitationId}`, { method: "DELETE" }, () =>
                  setNotice({ kind: "info", title: "招待を取り消しました" }),
                )
              }
              pending={pending === `cancel:${inv.invitationId}`}
              pendingLabel="取り消しています…"
            >
              取り消す
            </Button>
          </div>
        </div>
      );
    }
    if (inviting === item.teamMemberId) {
      return (
        <form onSubmit={(e) => void sendInvitation(e, item)} noValidate className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-3">
          <TextField
            id={`invite-${item.teamMemberId}`}
            label="本人のメールアドレス"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            error={inviteError}
            hint="本人がこのアドレスでログインすると、選手一覧や申し込みを見られるようになります"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-10" pending={pending === `invite:${item.teamMemberId}`} pendingLabel="送っています…">
              招待を送る
            </Button>
            <Button type="button" variant="secondary" className="min-h-10" onClick={() => setInviting(null)}>
              やめる
            </Button>
          </div>
        </form>
      );
    }
    return (
      <Button
        variant="secondary"
        className="min-h-10 self-start"
        onClick={() => {
          setInviting(item.teamMemberId);
          setInviteEmail("");
          setInviteError(null);
        }}
      >
        招待する
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      {roster.recentlyLeft.map((r) => (
        <UndoBar
          key={r.teamMemberId}
          message={`${r.name}さんを外しました`}
          onUndo={() => void call(`undo:${r.teamMemberId}`, `${base}/members/${r.teamMemberId}/undo-leave`, { method: "POST" })}
          pending={pending === `undo:${r.teamMemberId}`}
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
                {viewerCanManage ? accountLine(item) : null}
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
                      onClick={() => void call(`leave:${item.teamMemberId}`, `${base}/members/${item.teamMemberId}/leave`, { method: "POST" })}
                      pending={pending === `leave:${item.teamMemberId}`}
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
