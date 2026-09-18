"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";

export type AdminItem = { userId: string; email: string; displayName: string | null };
export type InvitationRowItem = { id: string; email: string; status: string; expiresAt: string };

const STATUS_LABEL: Record<string, string> = {
  pending: "返事待ち",
  accepted: "参加済み",
  rejected: "心当たりがない",
  cancelled: "取り消し",
  expired: "期限切れ",
};

// テナント管理者の招待・再送・取り消し・解除（§5.14「テナント管理者の招待」）。1 協会 5 名まで（返事待ちも数える）
export function AdminManagement({
  associationId,
  admins,
  invitations,
  pendingCount,
  maxAdmins,
}: {
  associationId: string;
  admins: AdminItem[];
  invitations: InvitationRowItem[];
  // 返事待ち（期限内）の数。サーバー側で数える（render の中で今の時刻を見ない）
  pendingCount: number;
  maxAdmins: number;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; title: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  async function call(key: string, input: RequestInfo, init: RequestInit, onOk: () => void) {
    if (pending) return;
    setPending(key);
    setNotice(null);
    setFieldError(null);
    try {
      const response = await fetch(input, init);
      const body = (await response.json().catch(() => null)) as { error?: { message?: string; field?: string } } | null;
      if (response.ok) {
        onOk();
        router.refresh();
      } else if (body?.error?.field === "email") {
        setFieldError(body.error.message ?? "入力を確かめてください");
      } else {
        setNotice({ kind: "error", title: body?.error?.message ?? "できませんでした" });
      }
    } catch {
      setNotice({ kind: "error", title: "できませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(null);
    }
  }

  const base = `/api/platform/associations/${associationId}/admin-invitations`;
  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  function onInvite(event: FormEvent) {
    event.preventDefault();
    void call("invite", base, json({ email }), () => {
      setNotice({ kind: "success", title: `${email.trim()} に招待のメールを送ります` });
      setEmail("");
    });
  }

  const openInvitations = invitations.filter((i) => i.status === "pending" || i.status === "expired");

  return (
    <div className="flex flex-col gap-6" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}

      <div className="flex flex-col gap-2">
        <h3 className="font-bold">管理者（{admins.length} 名）</h3>
        {admins.length === 0 ? <p className="text-sm text-muted">まだいません</p> : null}
        <ul className="flex flex-col gap-2">
          {admins.map((a) => (
            <li key={a.userId} className="flex flex-col gap-2 rounded-md border border-border px-4 py-2">
              <div>
                <span className="font-semibold">{a.displayName ?? "（表示名なし）"}</span>
                <span className="ml-2 text-sm text-muted">{a.email}</span>
              </div>
              {confirmRemove === a.userId ? (
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    onClick={() =>
                      call(`remove-${a.userId}`, `/api/platform/associations/${associationId}/admins/${a.userId}`, { method: "DELETE" }, () => {
                        setConfirmRemove(null);
                        setNotice({ kind: "info", title: `${a.email} を管理者から外しました` });
                      })
                    }
                    pending={pending === `remove-${a.userId}`}
                    pendingLabel="外しています…"
                  >
                    本当に外す
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
                    やめる
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmRemove(a.userId)} disabled={pending !== null}>
                  管理者から外す
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-bold">招待</h3>
        {openInvitations.length === 0 ? <p className="text-sm text-muted">返事待ちの招待はありません</p> : null}
        <ul className="flex flex-col gap-2">
          {openInvitations.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 rounded-md border border-border px-4 py-2">
              <div>
                <span className="font-semibold">{i.email}</span>
                <span className="ml-2 text-sm text-muted">
                  {STATUS_LABEL[i.status] ?? i.status}・{formatDateWithWeekday(todayInTokyo(new Date(i.expiresAt)))}まで
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => call(`resend-${i.id}`, base, json({ invitationId: i.id }), () => setNotice({ kind: "success", title: `${i.email} にもう一度送ります` }))}
                  pending={pending === `resend-${i.id}`}
                  pendingLabel="送っています…"
                >
                  もう一度送る
                </Button>
                <Button
                  variant="danger"
                  onClick={() =>
                    call(`cancel-${i.id}`, base, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ invitationId: i.id }) }, () =>
                      setNotice({ kind: "info", title: `${i.email} への招待を取り消しました` }),
                    )
                  }
                  pending={pending === `cancel-${i.id}`}
                  pendingLabel="取り消しています…"
                >
                  取り消す
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={onInvite} noValidate className="flex flex-col gap-3">
        <h3 className="font-bold">管理者を招待する</h3>
        <p className="text-sm text-muted">
          管理者と返事待ちの招待を合わせて {maxAdmins} 名まで（いま {admins.length + pendingCount} 名）。招待のメールが届いたアドレスで本人がログインして「参加する」と有効になります
        </p>
        <TextField
          id="invite-email"
          label="メールアドレス"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldError}
        />
        <Button type="submit" pending={pending === "invite"} pendingLabel="招待しています…" fullWidth>
          招待する
        </Button>
      </form>
    </div>
  );
}
