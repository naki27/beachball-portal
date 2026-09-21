"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";
import type { MergeCandidate } from "@/lib/admin/merge-members";

// 要確認の解消と、2 つの人物をまとめる操作（設計書 §5.8）
// まとめるのは 2 段階（相手を選ぶ → 残す人を選んで確かめる）。**元に戻す操作はない**

function personText(person: MergeCandidate): string {
  return [
    person.kana ?? "",
    `${person.birthDate}（${person.age}歳）`,
    person.sex === "male" ? "男性" : "女性",
    person.teamNames.length > 0 ? person.teamNames.join("・") : "チームなし",
    `申込 ${person.entryCount} 回`,
    person.linkedEmail ? "ログインできます" : "ログインの紐づけなし",
  ]
    .filter(Boolean)
    .join("・");
}

export function MergeControls({
  slug,
  member,
  candidates,
}: {
  slug: string;
  member: MergeCandidate;
  candidates: MergeCandidate[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [target, setTarget] = useState<MergeCandidate | null>(null);
  const [keepId, setKeepId] = useState(member.id);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function send(url: string, body?: Record<string, unknown>) {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setFailure(parsed?.error?.message ?? "できませんでした");
        return false;
      }
      return true;
    } catch {
      setFailure("できませんでした。電波の状態を確かめてください");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function markDifferent() {
    if (await send(`/api/${slug}/admin/members/${member.id}/reviewed`)) {
      router.push(`/${slug}/admin/members/${member.id}?reviewed=1`);
      router.refresh();
    }
  }

  async function merge() {
    if (!target) return;
    const removeId = keepId === member.id ? target.id : member.id;
    const intoId = keepId === member.id ? member.id : target.id;
    if (await send(`/api/${slug}/admin/members/${removeId}/merge`, { into_member_id: intoId })) {
      router.push(`/${slug}/admin/members/${intoId}?merged=1`);
      router.refresh();
    }
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {failure ? <Message kind="error" title={failure} /> : null}

      {member.status === "needs_review" ? (
        <section aria-labelledby="review-different" className="flex flex-col gap-2">
          <h2 id="review-different" className="text-lg font-bold">
            別の人のとき
          </h2>
          <p className="text-sm text-muted">同じ名前の別の人であれば、確認の印を外します。登録はそのまま残ります。</p>
          <Button variant="secondary" className="self-start" onClick={markDifferent} pending={pending} pendingLabel="記録しています…">
            別の人です
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="review-merge" className="flex flex-col gap-3">
        <h2 id="review-merge" className="text-lg font-bold">
          同じ人のとき（まとめる）
        </h2>
        {candidates.length === 0 ? (
          <p>同じ氏名・同じ生年月日の登録は見つかりませんでした。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="font-semibold break-words">{candidate.name}</p>
                <p className="text-sm text-muted break-words">{personText(candidate)}</p>
                <p className="text-sm">
                  {candidate.sameName ? "氏名が同じ" : ""}
                  {candidate.sameName && candidate.sameKanaAndBirth ? "・" : ""}
                  {candidate.sameKanaAndBirth ? "ふりがなと生年月日が同じ" : ""}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    setTarget(candidate);
                    setKeepId(candidate.linkedEmail && !member.linkedEmail ? candidate.id : member.id);
                    setFailure(null);
                  }}
                >
                  この登録とまとめる
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {target ? (
        <section aria-labelledby="review-confirm" className="flex flex-col gap-3 rounded-md border border-danger bg-danger-surface p-4">
          <h2 id="review-confirm" className="text-lg font-bold">
            まとめる前の確認
          </h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-semibold">どちらの登録を残しますか</legend>
            {[member, target].map((person) => (
              <label key={person.id} className="flex min-h-12 items-start gap-2">
                <input
                  type="radio"
                  name="keep"
                  className="mt-1.5"
                  checked={keepId === person.id}
                  onChange={() => setKeepId(person.id)}
                />
                <span>
                  <span className="font-semibold break-words">{person.name}</span>
                  <span className="block text-sm break-words">{personText(person)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-sm">
            まとめると、選手一覧・協会員の資格・申し込みの紐づけが残す登録に移ります。もう一方は「まとめ済み」になり、候補に出なくなります。
            <strong>元に戻せません。</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" size="sm" onClick={merge} pending={pending} pendingLabel="まとめています…">
              まとめる
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setTarget(null)} disabled={pending}>
              やめる
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
