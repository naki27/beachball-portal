"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, Toolbar } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { PRESET_GENDER_LABEL, PRESET_RULE_TYPE_LABEL, type PresetField, parsePresetInput } from "@/lib/presets/preset-input";
import { EMPTY_PRESET_DRAFT, type PresetApiBody, type PresetDraft, PresetFields } from "./preset-fields";

// 「よく使う部」（部門プリセット）の一覧（設計書 §5.4）。大会に部を足すときの候補になる
// 足すのは別のページ（…/association/presets/new・§4.3「一覧と登録はページを分ける」）
// 記号（code）は前回コピー・年度比較の突合に使うので、作ったあとは変えられない

export type PresetRow = {
  id: string;
  code: string;
  labelDefault: string;
  gender: string;
  ruleType: string;
  ruleValue: string;
  courtSize: string;
  mixedMinMale: string;
  mixedMinFemale: string;
  sortOrder: string;
  isActive: boolean;
  usedBy: number;
};

export function PresetManager({
  slug,
  presets,
  addedId = null,
}: {
  slug: string;
  presets: PresetRow[];
  // 足したばかりの部。1 秒だけ強調する（§4.5「内容が変わった」）
  addedId?: string | null;
}) {
  const router = useRouter();
  const base = `/api/${slug}/admin/category-presets`;
  const newUrl = `/${slug}/admin/association/presets/new`;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PresetDraft>(EMPTY_PRESET_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<PresetField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const added = addedId ? presets.find((row) => row.id === addedId) : undefined;

  async function send(key: string, url: string, method: string, body: unknown, message: string): Promise<void> {
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
      const parsed = (await response.json().catch(() => null)) as PresetApiBody | null;
      if (response.ok) {
        setDone(message);
        setErrors({});
        setEditingId(null);
        setDraft(EMPTY_PRESET_DRAFT);
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

  function saveEdit(id: string) {
    // 編集では記号を送らない（サーバー側で今の記号を使う）ので、記号の誤りは見ない
    const parsed = parsePresetInput({ ...draft, code: "placeholder" });
    if (!parsed.ok && parsed.field !== "code") {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    void send(`edit:${id}`, `${base}/${id}`, "PATCH", draft, `${draft.labelDefault}を保存しました`);
  }

  function remove(row: PresetRow) {
    if (!window.confirm(`${row.labelDefault}を削除します。よろしいですか？`)) return;
    void send(`remove:${row.id}`, `${base}/${row.id}`, "DELETE", undefined, `${row.labelDefault}を削除しました`);
  }

  function startEdit(row: PresetRow) {
    setEditingId(row.id);
    setErrors({});
    setNotice(null);
    setDone(null);
    setDraft({
      code: row.code,
      labelDefault: row.labelDefault,
      gender: row.gender,
      ruleType: row.ruleType,
      ruleValue: row.ruleValue,
      courtSize: row.courtSize,
      mixedMinMale: row.mixedMinMale,
      mixedMinFemale: row.mixedMinFemale,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        大会に部を足すときの候補です。大会ごとの名前・締切・基準日は、大会の画面で変えられます。
      </p>
      {added ? <Message kind="success" title={`${added.labelDefault}を追加しました`} /> : null}
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      {presets.length > 0 ? (
        <Toolbar>
          <span className="text-sm font-semibold">{presets.length} 件</span>
          <Link href={newUrl} className={`${buttonClass("primary", false, "sm")} ml-auto`}>
            新しい部を足す
          </Link>
        </Toolbar>
      ) : null}

      {presets.length === 0 ? (
        <EmptyState
          title="まだ部はありません"
          description="よく使う部を足しておくと、大会を作るときに選ぶだけで済みます。"
          action={
            <Link href={newUrl} className={buttonClass()}>
              新しい部を足す
            </Link>
          }
        />
      ) : (
        <ul className="bb-stagger grid gap-3 md:grid-cols-2">
          {presets.map((row) => (
            <li key={row.id}>
              <Card className={`flex h-full flex-col gap-1 ${row.id === addedId ? "bb-highlight" : ""}`}>
                <p className="flex flex-wrap items-center gap-2 font-semibold break-words">
                  {row.labelDefault}
                  {row.isActive ? null : <Badge tone="neutral">候補に出さない</Badge>}
                </p>
                <p className="text-sm text-muted">
                  記号 {row.code}・{PRESET_GENDER_LABEL[row.gender as keyof typeof PRESET_GENDER_LABEL]}・
                  {PRESET_RULE_TYPE_LABEL[row.ruleType as keyof typeof PRESET_RULE_TYPE_LABEL]}
                  {row.ruleValue ? `（${row.ruleValue}）` : ""}・コート {row.courtSize} 人
                </p>
                <p className="text-sm text-muted">{row.usedBy > 0 ? `${row.usedBy} つの大会で使っています` : "まだ使われていません"}</p>
                {editingId === row.id ? (
                  <div className="mt-3 flex flex-col gap-4">
                    <PresetFields draft={draft} setDraft={setDraft} errors={errors} idPrefix={`preset-${row.id}`} withCode={false} />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => saveEdit(row.id)} pending={pending === `edit:${row.id}`} pendingLabel="保存しています…">
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
                      編集
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => remove(row)}
                      pending={pending === `remove:${row.id}`}
                      pendingLabel="削除しています…"
                      disabled={row.usedBy > 0}
                    >
                      削除
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
