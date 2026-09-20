"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { PRESET_GENDERS, PRESET_RULE_TYPES } from "@/lib/presets/default";
import {
  parsePresetInput,
  PRESET_CODE_MAX,
  PRESET_GENDER_LABEL,
  PRESET_LABEL_MAX,
  PRESET_RULE_TYPE_LABEL,
  type PresetField,
} from "@/lib/presets/preset-input";

// 「よく使う部」（部門プリセット）の管理（設計書 §5.4）。大会に部を足すときの候補になる
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

type Draft = Omit<PresetRow, "id" | "usedBy">;

const EMPTY: Draft = {
  code: "",
  labelDefault: "",
  gender: "male",
  ruleType: "free",
  ruleValue: "",
  courtSize: "4",
  mixedMinMale: "1",
  mixedMinFemale: "2",
  sortOrder: "100",
  isActive: true,
};

type ApiBody = { error?: { message?: string; field?: PresetField } };

export function PresetManager({ slug, presets }: { slug: string; presets: PresetRow[] }) {
  const router = useRouter();
  const base = `/api/${slug}/admin/category-presets`;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<PresetField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

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
      const parsed = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        setDone(message);
        setErrors({});
        setEditingId(null);
        setCreating(false);
        setDraft(EMPTY);
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

  function submit(kind: "create" | "edit", id?: string) {
    const parsed = parsePresetInput({ ...draft, code: kind === "create" ? draft.code : "placeholder" });
    // 編集では記号を送らない（サーバー側で今の記号を使う）ので、記号の誤りだけは作成のときに見る
    if (!parsed.ok && !(kind === "edit" && parsed.field === "code")) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    if (kind === "create") void send("create", base, "POST", draft, `${draft.labelDefault}を追加しました`);
    else void send(`edit:${id}`, `${base}/${id}`, "PATCH", draft, `${draft.labelDefault}を保存しました`);
  }

  function remove(row: PresetRow) {
    if (!window.confirm(`${row.labelDefault}を削除します。よろしいですか？`)) return;
    void send(`remove:${row.id}`, `${base}/${row.id}`, "DELETE", undefined, `${row.labelDefault}を削除しました`);
  }

  function startEdit(row: PresetRow) {
    setCreating(false);
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

  const fields = (idPrefix: string, withCode: boolean) => (
    <div className="flex flex-col gap-4">
      {withCode ? (
        <TextField
          id={`${idPrefix}-code`}
          label="記号"
          value={draft.code}
          onChange={(e) => setDraft({ ...draft, code: e.target.value })}
          error={errors.code}
          maxLength={PRESET_CODE_MAX}
          hint="半角の英小文字・数字・_ で、協会の中で重ならないもの（例: m_40）。あとから変えられません。"
        />
      ) : null}
      <TextField
        id={`${idPrefix}-label`}
        label="部の名前"
        value={draft.labelDefault}
        onChange={(e) => setDraft({ ...draft, labelDefault: e.target.value })}
        error={errors.labelDefault}
        maxLength={PRESET_LABEL_MAX * 2}
        hint="大会ごとに名前は変えられます（「混合」↔「MIX」など）。"
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-gender`} className="font-semibold">
          男女の別
        </label>
        <select
          id={`${idPrefix}-gender`}
          value={draft.gender}
          onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          {PRESET_GENDERS.map((g) => (
            <option key={g} value={g}>
              {PRESET_GENDER_LABEL[g]}
            </option>
          ))}
        </select>
        {errors.gender ? <p className="text-sm font-semibold text-danger">{errors.gender}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-rule`} className="font-semibold">
          年齢の条件
        </label>
        <select
          id={`${idPrefix}-rule`}
          value={draft.ruleType}
          onChange={(e) => setDraft({ ...draft, ruleType: e.target.value, ruleValue: e.target.value === "free" ? "" : draft.ruleValue })}
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          {PRESET_RULE_TYPES.map((r) => (
            <option key={r} value={r}>
              {PRESET_RULE_TYPE_LABEL[r]}
            </option>
          ))}
        </select>
        {errors.ruleType ? <p className="text-sm font-semibold text-danger">{errors.ruleType}</p> : null}
      </div>
      {draft.ruleType === "free" ? null : (
        <TextField
          id={`${idPrefix}-rule-value`}
          label="年齢の数"
          type="number"
          inputMode="numeric"
          min={1}
          value={draft.ruleValue}
          onChange={(e) => setDraft({ ...draft, ruleValue: e.target.value })}
          error={errors.ruleValue}
          hint={draft.ruleType === "total_age" ? "合計年齢の基準（例: 160）。" : "この歳以上が出られます（例: 40）。"}
        />
      )}
      <TextField
        id={`${idPrefix}-court-size`}
        label="コートに出る人数"
        type="number"
        inputMode="numeric"
        min={1}
        value={draft.courtSize}
        onChange={(e) => setDraft({ ...draft, courtSize: e.target.value })}
        error={errors.courtSize}
      />
      {draft.gender === "mixed" ? (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            id={`${idPrefix}-min-male`}
            label="男性の最少人数"
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.mixedMinMale}
            onChange={(e) => setDraft({ ...draft, mixedMinMale: e.target.value })}
            error={errors.mixedMinMale}
          />
          <TextField
            id={`${idPrefix}-min-female`}
            label="女性の最少人数"
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.mixedMinFemale}
            onChange={(e) => setDraft({ ...draft, mixedMinFemale: e.target.value })}
            error={errors.mixedMinFemale}
          />
        </div>
      ) : null}
      <TextField
        id={`${idPrefix}-sort`}
        label="並び順"
        type="number"
        inputMode="numeric"
        min={0}
        value={draft.sortOrder}
        onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
        error={errors.sortOrder}
        hint="小さい数ほど先に出ます。"
      />
      <label className="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
          className="size-5"
        />
        <span className="font-semibold">新しい大会の候補に出す</span>
      </label>
    </div>
  );

  return (
    <section aria-labelledby="presets-heading" className="flex flex-col gap-5">
      <h2 id="presets-heading" className="text-lg font-bold">
        よく使う部
      </h2>
      <p className="text-sm leading-relaxed text-muted">
        大会に部を足すときの候補です。大会ごとの名前・締切・基準日は、大会の画面で変えられます。
      </p>
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      <ul className="flex flex-col gap-3">
        {presets.map((row) => (
          <li key={row.id} className="rounded-md border border-border px-4 py-3">
            <p className="font-semibold break-words">
              {row.labelDefault}
              {row.isActive ? null : <span className="ml-2 text-sm font-normal text-muted">（候補に出さない）</span>}
            </p>
            <p className="text-sm text-muted">
              記号 {row.code}・{PRESET_GENDER_LABEL[row.gender as keyof typeof PRESET_GENDER_LABEL]}・
              {PRESET_RULE_TYPE_LABEL[row.ruleType as keyof typeof PRESET_RULE_TYPE_LABEL]}
              {row.ruleValue ? `（${row.ruleValue}）` : ""}・コート {row.courtSize} 人
            </p>
            <p className="text-sm text-muted">{row.usedBy > 0 ? `${row.usedBy} つの大会で使っています` : "まだ使われていません"}</p>
            {editingId === row.id ? (
              <div className="mt-3 flex flex-col gap-4">
                {fields(`preset-${row.id}`, false)}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => submit("edit", row.id)} pending={pending === `edit:${row.id}`} pendingLabel="保存しています…">
                    保存する
                  </Button>
                  <Button variant="secondary" onClick={() => setEditingId(null)}>
                    やめる
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => startEdit(row)}>
                  編集
                </Button>
                <Button variant="danger" onClick={() => remove(row)} pending={pending === `remove:${row.id}`} pendingLabel="削除しています…" disabled={row.usedBy > 0}>
                  削除
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {creating ? (
        <div className="flex flex-col gap-4 rounded-md border border-border px-4 py-3">
          <h3 className="text-base font-bold">新しい部を足す</h3>
          {fields("preset-new", true)}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => submit("create")} pending={pending === "create"} pendingLabel="追加しています…">
              追加する
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button
          fullWidth
          variant="secondary"
          onClick={() => {
            setCreating(true);
            setEditingId(null);
            setDraft(EMPTY);
            setErrors({});
          }}
        >
          新しい部を足す
        </Button>
      )}
    </section>
  );
}
