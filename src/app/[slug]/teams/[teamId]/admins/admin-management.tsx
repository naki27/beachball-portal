"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";

type Admin = { userId: string; email: string; displayName: string | null };
type Invitation = { invitationId: string; email: string; expiresAt: string; expired: boolean };
type Candidate = { memberId: string; name: string };
type Notice = { kind: "success" | "error" | "info"; title: string };

// 代表者の一覧・解除・追加（招待）（§5.11「代表者の委譲」）
export function AdminManagement({
  slug,
  teamId,
  teamStatus,
  myUserId,
  admins,
  invitations,
  candidates,
}: {
  slug: string;
  teamId: string;
  teamStatus: "active" | "inactive";
  myUserId: string;
  admins: Admin[];
  invitations: Invitation[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const base = `/api/${slug}/teams/${teamId}`;
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState("");

  async function call(key: string, url: string, init: RequestInit, onOk?: (body: Record<string, unknown> | null) => void) {
    if (pending) return false;
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
      return true;
    } catch {
      setNotice({ kind: "error", title: "できませんでした。電波の状態を確かめてください" });
      return false;
    } finally {
      setPending(null);
    }
  }

  async function revoke(admin: Admin) {
    const self = admin.userId === myUserId;
    const ok = await call(`revoke:${admin.userId}`, `${base}/admins/${admin.userId}`, { method: "DELETE" });
    if (!ok) return;
    setConfirmRevoke(null);
    if (self) {
      // 自分が降りたので、この画面は見られない。マイページへ
      router.push("/mypage");
      router.refresh();
      return;
    }
    setNotice({ kind: "info", title: `${labelOf(admin)}さんを代表者から外しました` });
    router.refresh();
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    const body = candidate ? { kind: "admin", memberId: candidate } : { kind: "admin", email };
    if (!candidate && !email.includes("@")) {
      setEmailError("メールアドレスの形で入力してください");
      return;
    }
    setEmailError(null);
    const ok = await call("invite", `${base}/invitations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (ok) {
      setNotice({ kind: "success", title: "代表者としての招待のメールを送ります。本人が「参加する」を押すと代表者になります" });
      setEmail("");
      setCandidate("");
      router.refresh();
    }
  }

  const labelOf = (a: Admin) => a.displayName ?? a.email;
  const onlyOne = admins.length <= 1;

  return (
    <div className="flex flex-col gap-8" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}

      <section aria-labelledby="admins-now" className="flex flex-col gap-3">
        <h2 id="admins-now" className="text-lg font-bold">
          いまの代表者（{admins.length} 人）
        </h2>
        <ul className="flex flex-col gap-2">
          {admins.map((a) => {
            const self = a.userId === myUserId;
            return (
              <li key={a.userId} className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
                <div className="flex flex-col">
                  <span className="font-semibold break-words">
                    {labelOf(a)}
                    {self ? <span className="ml-2 text-sm font-normal text-muted">（あなた）</span> : null}
                  </span>
                  {a.displayName ? <span className="text-sm text-muted break-all">{a.email}</span> : null}
                </div>
                {onlyOne ? null : confirmRevoke === a.userId ? (
                  <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-3 py-2">
                    <p className="text-sm">
                      {self ? "代表者を降りると、このチームの選手一覧や申し込みを操作できなくなります。" : `${labelOf(a)}さんを代表者から外します。`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="danger" className="min-h-10" onClick={() => void revoke(a)} pending={pending === `revoke:${a.userId}`} pendingLabel="外しています…">
                        {self ? "代表者を降りる" : "外す"}
                      </Button>
                      <Button variant="secondary" className="min-h-10" onClick={() => setConfirmRevoke(null)}>
                        やめる
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="secondary" className="min-h-10 self-start" onClick={() => setConfirmRevoke(a.userId)}>
                    {self ? "代表者を降りる" : "外す"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {onlyOne ? <p className="text-sm text-muted">代表者が 1 人だけのときは外せません。先にほかの人を代表者に加えてください。</p> : null}
      </section>

      {invitations.length > 0 ? (
        <section aria-labelledby="admins-invited" className="flex flex-col gap-3">
          <h2 id="admins-invited" className="text-lg font-bold">
            返事待ち
          </h2>
          <ul className="flex flex-col gap-2">
            {invitations.map((inv) => {
              const until = formatDateWithWeekday(todayInTokyo(new Date(inv.expiresAt)));
              return (
                <li key={inv.invitationId} className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
                  <p className="text-sm">
                    <span className="break-all font-semibold">{inv.email}</span>・{inv.expired ? "招待の期限が切れました" : `${until}まで`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="min-h-10"
                      onClick={() =>
                        void call(`resend:${inv.invitationId}`, `${base}/invitations/${inv.invitationId}/resend`, { method: "POST" }, () => {
                          setNotice({ kind: "success", title: "招待のメールをもう一度送ります" });
                          router.refresh();
                        })
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
                        void call(`cancel:${inv.invitationId}`, `${base}/invitations/${inv.invitationId}`, { method: "DELETE" }, () => {
                          setNotice({ kind: "info", title: "招待を取り消しました" });
                          router.refresh();
                        })
                      }
                      pending={pending === `cancel:${inv.invitationId}`}
                      pendingLabel="取り消しています…"
                    >
                      取り消す
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="admins-add" className="flex flex-col gap-3">
        <h2 id="admins-add" className="text-lg font-bold">
          代表者を追加する
        </h2>
        {teamStatus === "inactive" ? (
          <p className="text-sm text-muted">このチームは無効になっているので招待できません。</p>
        ) : (
          <form onSubmit={(e) => void invite(e)} noValidate className="flex flex-col gap-4">
            {candidates.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="admin-candidate" className="font-semibold">
                  選手一覧から選ぶ（本人がログインできる人）
                </label>
                <select
                  id="admin-candidate"
                  value={candidate}
                  onChange={(e) => setCandidate(e.target.value)}
                  className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
                >
                  <option value="">選ばない（メールアドレスで招待する）</option>
                  {candidates.map((c) => (
                    <option key={c.memberId} value={c.memberId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {!candidate ? (
              <TextField
                id="admin-email"
                label="メールアドレスで招待する"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={emailError}
                hint="本人がこのアドレスでログインし、「参加する」を押すと代表者になります"
              />
            ) : null}
            <Button type="submit" pending={pending === "invite"} pendingLabel="送っています…">
              代表者として招待する
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
