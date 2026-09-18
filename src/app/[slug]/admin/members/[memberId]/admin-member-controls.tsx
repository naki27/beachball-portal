"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";

type TeamRow = { teamMemberId: string; teamId: string; teamName: string; kind: "team" | "individual" };
type Notice = { kind: "success" | "error" | "info"; title: string };

// 運営のメンバー管理: 選手一覧の行の削除（誤登録。なかったことにする）とアカウントとの紐づけの解除
export function AdminMemberControls({ slug, memberId, linkedEmail, teams }: { slug: string; memberId: string; linkedEmail: string | null; teams: TeamRow[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function call(key: string, url: string, onOk: () => void) {
    if (pending) return;
    setPending(key);
    setNotice(null);
    try {
      const response = await fetch(url, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setNotice({ kind: "error", title: body?.error?.message ?? "できませんでした" });
        return;
      }
      setConfirming(null);
      onOk();
      router.refresh();
    } catch {
      setNotice({ kind: "error", title: "できませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-8" data-hydrated={hydrated || undefined}>
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}

      <section aria-labelledby="admin-member-teams" className="flex flex-col gap-3">
        <h2 id="admin-member-teams" className="text-lg font-bold">
          載っている選手一覧
        </h2>
        {teams.length === 0 ? <p className="text-sm text-muted">どのチームの選手一覧にも載っていません。</p> : null}
        <ul className="flex flex-col gap-2">
          {teams.map((t) => (
            <li key={t.teamMemberId} className="flex flex-col gap-2 rounded-md border border-border px-4 py-2">
              <Link href={`/${slug}/teams/${t.teamId}/members`} className="font-semibold underline underline-offset-2">
                {t.kind === "individual" ? "個人登録" : t.teamName}
              </Link>
              {confirming === t.teamMemberId ? (
                <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-3 py-2">
                  <p className="text-sm">誤って登録された行として消します（なかったことにします）。人物の登録はほかの選手一覧に残ります。</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      className="min-h-10"
                      onClick={() =>
                        void call(`row:${t.teamMemberId}`, `/api/${slug}/admin/teams/${t.teamId}/members/${t.teamMemberId}`, () =>
                          setNotice({ kind: "info", title: `${t.teamName}の選手一覧の行を消しました` }),
                        )
                      }
                      pending={pending === `row:${t.teamMemberId}`}
                      pendingLabel="消しています…"
                    >
                      行を消す
                    </Button>
                    <Button variant="secondary" className="min-h-10" onClick={() => setConfirming(null)}>
                      やめる
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" className="min-h-10 self-start" onClick={() => setConfirming(t.teamMemberId)}>
                  誤登録として行を消す
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="admin-member-link" className="flex flex-col gap-3">
        <h2 id="admin-member-link" className="text-lg font-bold">
          アカウントとの結びつき
        </h2>
        {linkedEmail ? (
          <>
            <p className="text-sm">
              本人がログインできます: <span className="break-all font-semibold">{linkedEmail}</span>
            </p>
            {confirming === "unlink" ? (
              <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-surface px-3 py-2">
                <p className="text-sm">解除すると、本人はチームの選手一覧や申し込みを見られなくなります（名簿の登録は残ります）。</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    className="min-h-10"
                    onClick={() => void call("unlink", `/api/${slug}/members/${memberId}/link`, () => setNotice({ kind: "info", title: "アカウントとの結びつきを解除しました" }))}
                    pending={pending === "unlink"}
                    pendingLabel="解除しています…"
                  >
                    解除する
                  </Button>
                  <Button variant="secondary" className="min-h-10" onClick={() => setConfirming(null)}>
                    やめる
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" className="self-start" onClick={() => setConfirming("unlink")}>
                アカウントとの結びつきを解除する
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">アカウントと結びついていません（本人はログインできません）。代表者が選手一覧から招待できます。</p>
        )}
      </section>
    </div>
  );
}
