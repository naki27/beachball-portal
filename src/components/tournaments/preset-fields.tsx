"use client";

import { TextField } from "@/components/ui/text-field";
import { PRESET_GENDERS, PRESET_RULE_TYPES } from "@/lib/presets/default";
import {
  PRESET_CODE_MAX,
  PRESET_GENDER_LABEL,
  PRESET_LABEL_MAX,
  PRESET_RULE_TYPE_LABEL,
  type PresetField,
} from "@/lib/presets/preset-input";

// 「よく使う部門」（部門プリセット）の入力欄（設計書 §5.4）。「新しい部を足す」ページと一覧の中の「編集」で同じものを使う
// 記号（code）は前回コピー・年度比較の突合に使うので、作ったあとは変えられない（withCode は作成のときだけ true）

export type PresetDraft = {
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
};

export const EMPTY_PRESET_DRAFT: PresetDraft = {
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

export type PresetApiBody = { error?: { message?: string; field?: PresetField }; preset?: { id: string } };

export function PresetFields({
  draft,
  setDraft,
  errors,
  idPrefix,
  withCode,
}: {
  draft: PresetDraft;
  setDraft: (next: PresetDraft) => void;
  errors: Partial<Record<PresetField, string>>;
  idPrefix: string;
  withCode: boolean;
}) {
  const selectClass = "min-h-12 w-full rounded-md border border-border-strong bg-background px-3 text-base";
  return (
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-gender`} className="font-semibold">
            男女の別
          </label>
          <select
            id={`${idPrefix}-gender`}
            value={draft.gender}
            onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
            className={selectClass}
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
            onChange={(e) =>
              setDraft({ ...draft, ruleType: e.target.value, ruleValue: e.target.value === "free" ? "" : draft.ruleValue })
            }
            className={selectClass}
          >
            {PRESET_RULE_TYPES.map((r) => (
              <option key={r} value={r}>
                {PRESET_RULE_TYPE_LABEL[r]}
              </option>
            ))}
          </select>
          {errors.ruleType ? <p className="text-sm font-semibold text-danger">{errors.ruleType}</p> : null}
        </div>
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
}
