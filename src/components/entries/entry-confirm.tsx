"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionBar, Card } from "@/components/ui/layout";
import { Skeleton } from "@/components/ui/loading";
import { Message } from "@/components/ui/message";
import { useDraft } from "@/hooks/use-draft";
import { useHydrated } from "@/hooks/use-hydrated";
import { ageAt } from "@/lib/age";
import { type PlainDate, parsePlainDate, todayInTokyo } from "@/lib/date";
import { draftKey } from "@/lib/draft";
import { readCompletedEntry, saveCompletedEntry } from "@/lib/entries/completed";
import { parsePlayerSlots } from "@/lib/entries/player-slots";
import { saveSubmitError } from "@/lib/entries/submit-error";
import { SEX_LABEL } from "@/lib/teams/player-input";
import type { EntryFormValues } from "./entry-form";

// 申込の確認ページ（設計書 §5.5「確認ページ」）
// チーム名・部・選手の氏名／年齢／性別・備考を出す。「入力に戻って直す」は上と下の両方に置く
// 断られたら（締切・定員・資格）入力ページに戻して理由を出す（確認ページに留めない）

export type EntryConfirmCategory = { id: string; label: string; referenceDate: PlainDate };

type ApiBody = {
  entryId?: string;
  redirectTo?: string;
  warnings?: { message: string }[];
  error?: { message?: string; field?: string; playerIndex?: number };
};

export function EntryConfirm({
  slug,
  associationId,
  tournamentId,
  tournamentName,
  categories,
}: {
  slug: string;
  associationId: string;
  tournamentId: string;
  tournamentName: string;
  categories: EntryConfirmCategory[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const key = draftKey({ associationId, screen: "entry-form", targetId: tournamentId });
  // 「今日」はこの画面が開いている間は変えない（描画のたびに時刻を読まない）
  const [today] = useState(() => todayInTokyo());
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 入力ページが一時保存した値をそのまま読む（§4.3）。確認ページは新しい値を作らない
  const draft = useDraft<EntryFormValues>(key);
  const values = draft.restored;

  const inputHref = `/${slug}/tournaments/${tournamentId}/entry`;

  function backToInput() {
    router.push(inputHref);
  }

  async function onSubmit() {
    if (!values || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${slug}/tournaments/${tournamentId}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const parsed = (await response.json().catch(() => ({}))) as ApiBody;
      if (!response.ok) {
        const message = parsed.error?.message ?? "送信できませんでした。少し待ってからお試しください";
        // 締切・定員・資格は入力ページに戻して理由を出す（§5.5）。それ以外はこの画面に出す
        if (response.status === 400 || response.status === 409) {
          saveSubmitError(key, { message, field: parsed.error?.field, playerIndex: parsed.error?.playerIndex });
          backToInput();
          return;
        }
        setNotice(message);
        setPending(false);
        return;
      }
      // 送信が済んだら一時保存を消す（生年月日を端末に残さない・§4.3）。申込番号だけ覚えておく
      draft.clear();
      if (parsed.entryId) saveCompletedEntry(key, parsed.entryId);
      router.push(parsed.redirectTo ?? `/${slug}/tournaments/${tournamentId}`);
    } catch {
      setNotice("送信できませんでした。電波の届くところでもう一度お試しください");
      setPending(false);
    }
  }

  if (!hydrated) return <Skeleton className="h-64 w-full" />;

  if (!values) {
    // 完了後に「戻る」で来た場合は、再送させずに完了ページへ案内する（§5.5）
    const completed = readCompletedEntry(key);
    if (completed) {
      return (
        <Message kind="info" title="この申し込みはすでに完了しています">
          <p>同じ内容をもう一度送る必要はありません。</p>
          <Button className="mt-2" onClick={() => router.push(`/${slug}/entries/${completed}`)}>
            申し込みの内容を見る
          </Button>
        </Message>
      );
    }
    return (
      <Message kind="info" title="入力した内容が見つかりません">
        <p>この端末に保存された内容が消えています。もう一度入力してください。</p>
        <Button className="mt-2" onClick={backToInput}>
          入力ページへ
        </Button>
      </Message>
    );
  }

  const category = categories.find((c) => c.id === values.categoryId);
  const players = parsePlayerSlots(values.slots, today);

  function ageText(birthDate: string | null): string {
    const birth = birthDate ? parsePlainDate(birthDate) : null;
    return birth && category ? `${ageAt(birth, category.referenceDate)}歳` : "";
  }

  return (
    <div data-hydrated className="flex flex-col gap-6">
      <Button variant="secondary" onClick={backToInput} fullWidth>
        入力に戻って直す
      </Button>

      <Card>
        <dl className="flex flex-col gap-3">
        <div>
          <dt className="font-semibold">大会</dt>
          <dd>{tournamentName}</dd>
        </div>
        <div>
          <dt className="font-semibold">チーム名（公開されます）</dt>
          <dd>{values.teamName}</dd>
        </div>
        <div>
          <dt className="font-semibold">部</dt>
          <dd>{category?.label ?? ""}</dd>
        </div>
        <div>
          <dt className="font-semibold">出場する選手</dt>
          <dd>
            <ol className="flex flex-col gap-1">
              {values.slots
                .filter((slot) => slot.name.trim())
                .map((slot, index) => (
                  // 枠の並びは入力ページのまま
                  <li key={`${slot.memberId ?? "manual"}-${index}`}>
                    {index + 1}. {slot.name}
                    <span className="ml-2 text-sm text-muted">
                      {[ageText(slot.birthDate), slot.sex ? SEX_LABEL[slot.sex] : ""].filter(Boolean).join("・")}
                    </span>
                  </li>
                ))}
            </ol>
          </dd>
        </div>
        {values.note ? (
          <div>
            <dt className="font-semibold">備考</dt>
            <dd className="whitespace-pre-wrap break-words">{values.note}</dd>
          </div>
        ) : null}
        </dl>
      </Card>

      {!players.ok ? (
        <Message kind="error" title="入力に足りないところがあります">
          <p>{players.issues[0].message}</p>
        </Message>
      ) : null}
      {notice ? <Message kind="error" title={notice} /> : null}

      {/* 主要操作はスマホだけ画面の下に貼り付ける（§4.3・v0.9.6）。PC は横並び */}
      <ActionBar>
        <Button fullWidth onClick={onSubmit} pending={pending} pendingLabel="申し込んでいます…" disabled={!players.ok}>
          申し込む
        </Button>
        <Button variant="secondary" onClick={backToInput} fullWidth>
          入力に戻って直す
        </Button>
      </ActionBar>
    </div>
  );
}
