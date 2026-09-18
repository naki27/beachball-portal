"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";

type Admin = { userId: string; email: string; displayName: string | null };
type Notice = { kind: "success" | "error" | "info"; title: string };

// 運営のチーム管理: 代表者の付け替え（追加は承諾なし・解除は最後の 1 人は不可）と削除（論理）
export function AdminTeamControls({ slug, teamId, admins }: { slug: string; teamId: string; admins: Admin[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function call(key: string, url: string, init: RequestInit): Promise<{ ok: boolean; body: (Record<string, unknown> & { error?: { message?: string; field?: string } }) | null }> {
    if (pending) return { ok: false, body: null };
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, init);
      const body = (await response.json().catch(() => null)) as (Record<string, unknown> & { error?: { message?: string; field?: string } }) | null;
      if (!response.ok && !body?.error?.field) setNotice({ kind: "error", title: body?.error?.message ?? "できませんでした" });
      return { ok: response.ok, body };
    } catch {
      setNotice({ kind: "error", title: "できませんでした。電波の状態を確かめてください" });
      return { ok: false, body: null };
    } finally {
      setPending(null);
    }
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!email.includes("@")) {
      setEmailError("メールアドレスの形で入力してください");
      return;
    }
    setEmailError(null);
    const { ok, body } = await call("assign", `/api/${slug}/admin/teams/${teamId}/admins`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (ok) {
      setNotice({ kind: "success", title: "代表者に加えました" });
      setEmail("");
      router.refresh();
    } else if (body?.error?.field === "email") {
      setEmailError(body.error.message ?? "確かめてください");
    }
  }

  async function revoke(admin: Admin) {
    const { ok } = await call(`revoke:${admin.userId}`, `/api/${slug}/teams/${teamId}/admins/${admin.userId}`, { method: "DELETE" });
    if (ok) {
      setNotice({ kind: "info", title: `${admin.displayName ?? admin.email}さんを代表者から外しました` });
      router.refresh();
    }
  }

  async function remove() {
    const { ok } = await call("delete", `/api/${slug}/admin/teams/${teamId}`, { method: "DELETE" });
    if (ok) {
      router.push(`/${slug}/admin/teams`);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-8" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}

      <section aria-labelledby="admin-team-admins" className="flex flex-col gap-3">
        <h2 id="admin-team-admins" className="text-lg font-bold">
          代表者（{admins.length} 人）
        </h2>
        {admins.length === 0 ? <p className="text-sm text-muted">代表者がいません。</p> : null}
        <ul className="flex flex-col gap-2">
          {admins.map((a) => (
            <li key={a.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-2">
              <span className="flex flex-col">
                <span className="font-semibold break-all">{a.displayName ?? a.email}</span>
                {a.displayName ? <span className="text-sm text-muted break-all">{a.email}</span> : null}
              </span>
              {admins.length > 1 ? (
                <Button variant="secondary" className="min-h-10" onClick={() => void revoke(a)} pending={pending === `revoke:${a.userId}`} pendingLabel="外しています…">
                  外す
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {admins.length === 1 ? <p className="text-sm text-muted">最後の代表者は外せません。先にほかの人を加えてください。</p> : null}
        <form onSubmit={(e) => void assign(e)} noValidate className="flex flex-col gap-3">
          <TextField
            id="admin-assign-email"
            label="代表者を加える（アカウントのメールアドレス）"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
            hint="協会の管理者が加えるときは、本人の承諾なしにすぐ代表者になります。一度もログインしたことのないアドレスは加えられません"
          />
          <Button type="submit" variant="secondary" className="self-start" pending={pending === "assign"} pendingLabel="加えています…">
            代表者に加える
          </Button>
        </form>
      </section>

      <section aria-labelledby="admin-team-delete" className="flex flex-col gap-3">
        <h2 id="admin-team-delete" className="text-lg font-bold">
          削除
        </h2>
        {confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-4 py-3">
            <p className="text-sm">
              このチームを削除します。画面から見えなくなり、返事待ちの招待は取り消されます。締切後・開催済みの申し込みはそのまま残ります。あとで「削除済みデータ」から戻せます。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" className="min-h-10" onClick={() => void remove()} pending={pending === "delete"} pendingLabel="削除しています…">
                削除する
              </Button>
              <Button variant="secondary" className="min-h-10" onClick={() => setConfirmDelete(false)}>
                やめる
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" className="self-start" onClick={() => setConfirmDelete(true)}>
            このチームを削除する
          </Button>
        )}
      </section>
    </div>
  );
}
