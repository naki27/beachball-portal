"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";

// 年度更新の申告（設計書 §5.12「申告フロー」・§4.5「年度更新・管理画面」）
// 名簿にチェックを入れて送るだけ。昨年度の会員には初期チェックと「昨年度の会員」の印
// 「12人中10人を2027年度も登録します」はチェックに合わせてその場で変わる

export type DeclarationPlayerView = {
  memberId: string;
  name: string;
  kana: string | null;
  wasMemberLastYear: boolean;
  // いまの状態の文言（「協会員（2027年度）」「運営の確認待ち」など）。まだ何もなければ null
  statusText: string | null;
  checked: boolean;
};

export function DeclarationForm({
  slug,
  teamId,
  year,
  players,
  submitted,
  autoApprove,
}: {
  slug: string;
  teamId: string;
  year: number;
  players: DeclarationPlayerView[];
  // すでに送信しているか
  submitted: boolean;
  // 承認を省く年度か
  autoApprove: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(players.filter((p) => p.checked).map((p) => p.memberId)));
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggle(memberId: string): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (pending) return;
    setNotice(null);
    setDone(null);
    setPending(true);
    try {
      const response = await fetch(`/api/${slug}/teams/${teamId}/membership`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberIds: [...checked] }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (response.ok) {
        setDone(`${year}年度の申告を送りました`);
        router.refresh();
        return;
      }
      setNotice(body?.error?.message ?? "送れませんでした");
    } catch {
      setNotice("送れませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}
      {submitted && !done ? (
        <Message kind="info" title={`${year}年度の申告は送信済みです`}>
          締切までは、選ぶ人を変えて送り直せます。変えなかった人の状態はそのままです。
        </Message>
      ) : null}

      <p aria-live="polite" className="text-lg font-bold">
        {players.length}人中{checked.size}人を{year}年度も登録します
      </p>

      <ul className="flex flex-col gap-2">
        {players.map((player) => (
          <li key={player.memberId}>
            <label className="flex min-h-14 items-center gap-3 rounded-md border border-border px-3 py-2">
              <input
                type="checkbox"
                checked={checked.has(player.memberId)}
                onChange={() => toggle(player.memberId)}
                className="size-6 shrink-0"
              />
              <span className="flex flex-col">
                <span className="font-semibold break-words">{player.name}</span>
                <span className="text-sm text-muted">
                  {player.kana ? `${player.kana}・` : ""}
                  {player.wasMemberLastYear ? "昨年度の会員" : "昨年度は会員ではありません"}
                  {player.statusText ? `・${player.statusText}` : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
        {players.length === 0 ? <li className="text-muted">選手一覧にまだ誰もいません。</li> : null}
      </ul>

      <p className="text-sm text-muted">
        名簿にいない人は、先に{" "}
        <Link href={`/${slug}/teams/${teamId}/members/new`} className="underline underline-offset-2">
          選手を追加
        </Link>{" "}
        してから選んでください。
        {autoApprove ? "この年度は、送るとそのまま協会員になります。" : "送ったあと、運営が確認して協会員になります。"}
      </p>

      <Button pending={pending} pendingLabel="送っています…" onClick={() => void submit()} fullWidth>
        {submitted ? "この内容で送り直す" : "この内容で送る"}
      </Button>
    </section>
  );
}
