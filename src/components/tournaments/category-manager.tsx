"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, EmptyState, Toolbar } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { CATEGORY_LABEL_MAX, type CategoryField, parseCategoryInput } from "@/lib/tournaments/category-input";

// 大会の部の一覧（設計書 §5.4）。テナント管理者だけが開ける画面の部品
// 追加は別のページ（…/categories/new・§4.3「一覧と登録はページを分ける」）
// 日付はすべて "YYYY-MM-DD" の文字列で扱い、空欄は「大会の値に従う」を意味する

export type CategoryRowView = {
  id: string;
  label: string;
  condition: string;
  entries: number;
  // 部ごとの上書き（空欄なら大会の値）
  entryEndDate: string;
  ageReferenceDate: string;
  maxEntries: string;
  // 実際に効く値（大会の値を含めたもの）
  effectiveEntryEndText: string;
  effectiveAgeReferenceText: string;
};

export type PresetRowView = { id: string; label: string; condition: string };

export type AgeWarningView = { entryId: string; teamName: string; categoryLabel: string; players: { name: string; before: string; after: number }[] };

type Draft = { label: string; entryEndDate: string; ageReferenceDate: string; maxEntries: string };

type ApiBody = { error?: { message?: string; field?: CategoryField }; entries?: number };

export function CategoryManager({
  slug,
  tournamentId,
  categories,
  ageWarnings,
  tournamentEntryEndText,
  tournamentAgeReferenceText,
  addedCount = 0,
  skippedCount = 0,
}: {
  slug: string;
  tournamentId: string;
  categories: CategoryRowView[];
  ageWarnings: AgeWarningView[];
  tournamentEntryEndText: string;
  tournamentAgeReferenceText: string;
  // 「部を追加する」から戻ってきたとき（?added=…&skipped=…）
  addedCount?: number;
  skippedCount?: number;
}) {
  const router = useRouter();
  const base = `/api/${slug}/admin/tournaments/${tournamentId}`;
  const newUrl = `/${slug}/admin/tournaments/${tournamentId}/categories/new`;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ label: "", entryEndDate: "", ageReferenceDate: "", maxEntries: "" });
  const [errors, setErrors] = useState<Partial<Record<CategoryField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // 応答の読み取りと画面の更新をまとめる。成功したら done に出す文言を返す
  async function send(key: string, url: string, method: string, body: unknown, onOk: (body: ApiBody | null) => string): Promise<void> {
    if (pending) return;
    setNotice(null);
    setDone(null);
    setPending(key);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        setDone(onOk(parsed));
        setErrors({});
        setEditingId(null);
        router.refresh();
        return;
      }
      if (parsed?.error?.field) setErrors({ [parsed.error.field]: parsed.error.message ?? "入力を確かめてください" });
      setNotice(parsed?.error?.message ?? "保存できませんでした");
    } catch {
      setNotice("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(null);
    }
  }

  function startEdit(row: CategoryRowView) {
    setEditingId(row.id);
    setErrors({});
    setNotice(null);
    setDone(null);
    setDraft({ label: row.label, entryEndDate: row.entryEndDate, ageReferenceDate: row.ageReferenceDate, maxEntries: row.maxEntries });
  }

  function save(row: CategoryRowView) {
    const parsed = parseCategoryInput(draft);
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    void send(`save:${row.id}`, `${base}/categories/${row.id}`, "PATCH", draft, () => `${draft.label}を保存しました`);
  }

  function remove(row: CategoryRowView) {
    if (!window.confirm(`${row.label}をこの大会から外します。よろしいですか？`)) return;
    void send(`remove:${row.id}`, `${base}/categories/${row.id}`, "DELETE", undefined, () => `${row.label}を外しました`);
  }

  function confirmAges() {
    if (!window.confirm("申し込みに保存されている年齢を、いまの基準日で数え直します。よろしいですか？")) return;
    void send("ages", `${base}/age-reference/confirm`, "POST", {}, (body) => `${body?.entries ?? 0} 件の申し込みの年齢を確定しました`);
  }

  return (
    <div className="flex flex-col gap-4">
      {addedCount > 0 ? (
        <Message
          kind="success"
          title={`${addedCount} つの部を追加しました${skippedCount > 0 ? `（すでにある ${skippedCount} つは飛ばしました）` : ""}`}
        />
      ) : null}
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      {ageWarnings.length > 0 ? (
        <Message kind="info" title="年齢の基準日が申し込みのときと変わっています">
          <p>
            申し込みに保存されている年齢は、申し込んだときのままです。いまの基準日（{tournamentAgeReferenceText}）で数え直すときは、下のボタンを押してください。
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {ageWarnings.map((w) => (
              <li key={w.entryId} className="text-sm">
                {w.teamName}（{w.categoryLabel}）:{" "}
                {w.players.map((p) => `${p.name}さん ${p.before} → ${p.after}歳`).join("、")}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Button variant="secondary" onClick={confirmAges} pending={pending === "ages"} pendingLabel="確定しています…">
              新しい基準日で確定する
            </Button>
          </div>
        </Message>
      ) : null}

      {categories.length > 0 ? (
        <Toolbar>
          <span className="text-sm font-semibold">{categories.length} つの部</span>
          <Link href={newUrl} className={`${buttonClass("primary", false, "sm")} ml-auto`}>
            部を追加する
          </Link>
        </Toolbar>
      ) : null}

      {categories.length === 0 ? (
        <EmptyState
          title="まだ部がありません"
          description="「よく使う部門」から選んで、この大会に足してください。"
          action={
            <Link href={newUrl} className={buttonClass()}>
              部を追加する
            </Link>
          }
        />
      ) : (
        <ul className="bb-stagger grid gap-3 md:grid-cols-2">
          {categories.map((row) => (
            <li key={row.id}>
              <Card hoverable className="flex h-full flex-col gap-1">
                <p className="font-semibold break-words">{row.label}</p>
                <p className="text-sm text-muted">{row.condition}</p>
                <p className="text-sm text-muted">
                  締切 {row.effectiveEntryEndText}
                  {row.entryEndDate ? "（この部だけ別）" : "（大会と同じ）"}・基準日 {row.effectiveAgeReferenceText}
                  {row.ageReferenceDate ? "（この部だけ別）" : "（大会と同じ）"}
                </p>
                <p className="text-sm text-muted">
                  申し込み {row.entries} 件・上限 {row.maxEntries ? `${row.maxEntries} 件` : "大会の上限だけ"}
                </p>
                {editingId === row.id ? (
                  <div className="mt-3 flex flex-col gap-4">
                    <TextField
                      id={`category-label-${row.id}`}
                      label="部の名前"
                      value={draft.label}
                      onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                      error={errors.label}
                      maxLength={CATEGORY_LABEL_MAX * 2}
                    />
                    <TextField
                      id={`category-end-${row.id}`}
                      label="この部だけの締切日（任意）"
                      type="date"
                      value={draft.entryEndDate}
                      onChange={(e) => setDraft({ ...draft, entryEndDate: e.target.value })}
                      error={errors.entryEndDate}
                      hint={`空欄なら大会の締切（${tournamentEntryEndText}）です。`}
                    />
                    <TextField
                      id={`category-reference-${row.id}`}
                      label="この部だけの年齢の基準日（任意）"
                      type="date"
                      value={draft.ageReferenceDate}
                      onChange={(e) => setDraft({ ...draft, ageReferenceDate: e.target.value })}
                      error={errors.ageReferenceDate}
                      hint={`空欄なら大会の基準日（${tournamentAgeReferenceText}）です。`}
                    />
                    <TextField
                      id={`category-max-${row.id}`}
                      label="この部の申し込みの上限（任意）"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={draft.maxEntries}
                      onChange={(e) => setDraft({ ...draft, maxEntries: e.target.value })}
                      error={errors.maxEntries}
                      hint="空欄なら大会の上限だけを見ます。"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => save(row)} pending={pending === `save:${row.id}`} pendingLabel="保存しています…">
                        保存する
                      </Button>
                      <Button variant="secondary" onClick={() => setEditingId(null)}>
                        やめる
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    <Button variant="secondary" size="sm" onClick={() => startEdit(row)}>
                      この部を編集
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => remove(row)}
                      pending={pending === `remove:${row.id}`}
                      pendingLabel="外しています…"
                      disabled={row.entries > 0}
                    >
                      この大会から外す
                    </Button>
                  </div>
                )}
                {row.entries > 0 && editingId !== row.id ? (
                  <p className="mt-2 text-sm text-muted">申し込みがあるので外せません。</p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
