"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionBar, Card, EmptyState } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { MIXED_NOTATION_LABEL, MIXED_NOTATIONS, type MixedNotation } from "@/lib/presets/notation";
import type { PresetRowView } from "./category-manager";

type ApiBody = { error?: { message?: string }; added?: number; skipped?: number };

// 大会に部を追加するページ（設計書 §5.4・§4.3「一覧と登録はページを分ける」）
// 追加できたら大会の画面へ戻り、いくつ足したかを出す
export function CategoryAddForm({
  slug,
  tournamentId,
  presets,
  presetSettingsUrl,
}: {
  slug: string;
  tournamentId: string;
  // まだこの大会に入っていない「よく使う部」だけ
  presets: PresetRowView[];
  presetSettingsUrl: string;
}) {
  const router = useRouter();
  const listUrl = `/${slug}/admin/tournaments/${tournamentId}`;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notation, setNotation] = useState<MixedNotation>("kanji");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function add(): Promise<void> {
    if (pending) return;
    setNotice(null);
    setPending(true);
    try {
      const response = await fetch(`/api/${slug}/admin/tournaments/${tournamentId}/categories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ presetIds: [...selected], mixedNotation: notation }),
      });
      const body = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        const query = new URLSearchParams({ added: String(body?.added ?? 0), skipped: String(body?.skipped ?? 0) });
        router.push(`${listUrl}?${query.toString()}#categories`);
        return;
      }
      setNotice(body?.error?.message ?? "追加できませんでした");
    } catch {
      setNotice("追加できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  if (presets.length === 0) {
    return (
      <EmptyState
        title="追加できる部がありません"
        description="この大会には、候補の部がすべて入っています。"
        action={
          <Button variant="secondary" onClick={() => router.push(presetSettingsUrl)}>
            よく使う部の設定を開く
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Message kind="error" title={notice} /> : null}
      <Card className="flex flex-col gap-1.5">
        <label htmlFor="mixed-notation" className="font-semibold">
          混合の部の書き方
        </label>
        <select
          id="mixed-notation"
          value={notation}
          onChange={(e) => setNotation(e.target.value as MixedNotation)}
          aria-describedby="mixed-notation-hint"
          className="min-h-12 w-full rounded-md border border-border-strong bg-background px-3 text-base sm:max-w-xs"
        >
          {MIXED_NOTATIONS.map((value) => (
            <option key={value} value={value}>
              {MIXED_NOTATION_LABEL[value]}
            </option>
          ))}
        </select>
        <p id="mixed-notation-hint" className="text-sm text-muted">
          これから追加する部の名前に使います。追加したあとも部ごとに直せます。
        </p>
      </Card>

      <ul className="bb-stagger grid gap-2 md:grid-cols-2">
        {presets.map((preset) => (
          <li key={preset.id}>
            <label className="bb-pressable flex min-h-14 items-start gap-3 rounded-lg border border-border-strong bg-background px-4 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input
                type="checkbox"
                checked={selected.has(preset.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(preset.id);
                  else next.delete(preset.id);
                  setSelected(next);
                }}
                className="mt-1 size-5"
              />
              <span>
                <span className="font-semibold break-words">{preset.label}</span>
                <span className="block text-sm text-muted">{preset.condition}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <ActionBar>
        <Button
          fullWidth
          onClick={() => void add()}
          disabled={selected.size === 0}
          pending={pending}
          pendingLabel="追加しています…"
        >
          選んだ {selected.size} つの部を追加する
        </Button>
        <Button variant="secondary" onClick={() => router.push(listUrl)} fullWidth>
          やめる
        </Button>
      </ActionBar>
    </div>
  );
}
