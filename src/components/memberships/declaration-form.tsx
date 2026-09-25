"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MembershipStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";
import { fiscalYearLabel } from "@/lib/memberships/period-input";

// 年度更新の申告の入力（設計書 §5.12・§4.5「今年度も登録する人にチェック」）
// 「12人中10人を2027年度も登録します」をその場で更新。昨年度の会員には「昨年度の会員」ラベル

export type DeclarationPlayerView = {
  memberId: string;
  name: string;
  kana: string | null;
  lastYearMember: boolean;
  status: MembershipStatus | null;
  checked: boolean;
};

type ApiError = { error?: { message?: string } };

// 当年度の行の状態の言い方（§4.4）
function statusLabel(status: MembershipStatus | null, year: number): string | null {
  switch (status) {
    case "approved":
      return `協会員（${fiscalYearLabel(year)}）`;
    case "applied":
      return "運営の確認待ち";
    case "declined":
      return "更新しないと申告済み";
    case "expired":
      return "協会員ではない";
    default:
      return null;
  }
}

export function DeclarationForm({
  slug,
  teamId,
  year,
  autoApprove,
  canSubmit,
  declared,
  players,
}: {
  slug: string;
  teamId: string;
  year: number;
  autoApprove: boolean;
  canSubmit: boolean;
  declared: boolean;
  players: DeclarationPlayerView[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(players.filter((p) => p.checked).map((p) => p.memberId)));
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function toggle(memberId: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(memberId);
      else next.delete(memberId);
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !canSubmit) return;
    setPending(true);
    setDone(null);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/teams/${teamId}/membership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberIds: [...checked] }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiError | null;
        setFailure(body?.error?.message ?? "送れませんでした");
        return;
      }
      setDone(
        autoApprove
          ? `${fiscalYearLabel(year)}の申告を送りました。選んだ人はそのまま協会員として登録されました。控えをメールで送りました`
          : `${fiscalYearLabel(year)}の申告を送りました。運営が確認して承認します。控えをメールで送りました`,
      );
      router.refresh();
    } catch {
      setFailure("送れませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {done ? <Message kind="success" title={done} /> : null}
      {failure ? <Message kind="error" title={failure} /> : null}
      <p className="text-lg font-bold" aria-live="polite">
        {players.length}人中{checked.size}人を{fiscalYearLabel(year)}も登録します
      </p>
      {players.length === 0 ? (
        <p className="text-sm text-muted">選手一覧に誰もいません。下から選手を追加してください。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {players.map((p) => {
            const label = statusLabel(p.status, year);
            return (
              <li key={p.memberId}>
                <label className="flex min-h-14 items-start gap-3 rounded-md border border-border px-4 py-3">
                  <input
                    type="checkbox"
                    checked={checked.has(p.memberId)}
                    disabled={!canSubmit}
                    onChange={(e) => toggle(p.memberId, e.target.checked)}
                    className="mt-1 size-5"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold break-words">{p.name}</span>
                    {p.kana ? <span className="text-sm text-muted">{p.kana}</span> : null}
                    <span className="flex flex-wrap gap-2 text-sm">
                      {p.lastYearMember ? <span className="rounded-md bg-info-surface px-2 py-0.5">昨年度の会員</span> : null}
                      {label ? <span className="text-muted">{label}</span> : null}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {canSubmit ? (
        <>
          <p className="text-sm text-muted">
            チェックを外した人は「更新しない」として記録されます（昨年度の会員だけ）。
            {autoApprove ? "この年度は承認を省く設定なので、送るとそのまま協会員になります。" : "送ったあと、運営が内容を確認して承認します。"}
          </p>
          <Button type="submit" fullWidth pending={pending} pendingLabel="送っています…">
            {declared ? "申告を直して送る" : "申告を送る"}
          </Button>
        </>
      ) : null}
    </form>
  );
}
