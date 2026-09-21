"use client";

import { TextField } from "@/components/ui/text-field";
import type { PeriodField } from "@/lib/memberships/period-input";

// 年度更新の受付の入力欄（設計書 §5.12「受付開始」）。「受付を始める」ページと一覧の中の「直す」で同じものを使う
// 画面には「来年度」「次年度」と書かず、年度の数字で書く（§4.4）

export type PeriodDraft = { year: string; opensDate: string; closesDate: string; autoApprove: boolean };

export type PeriodApiBody = { error?: { message?: string; field?: PeriodField } };

export function PeriodFields({
  draft,
  setDraft,
  errors,
  idPrefix,
  showYear,
}: {
  draft: PeriodDraft;
  setDraft: (next: PeriodDraft) => void;
  errors: Partial<Record<PeriodField, string>>;
  idPrefix: string;
  showYear: boolean;
}) {
  return (
    <>
      {showYear ? (
        <TextField
          id={`${idPrefix}-year`}
          label="年度"
          inputMode="numeric"
          value={draft.year}
          error={errors.year}
          hint="4 月から始まる年度の、始まる年の数（2027年度なら 2027）"
          onChange={(event) => setDraft({ ...draft, year: event.target.value })}
        />
      ) : null}
      <TextField
        id={`${idPrefix}-opens`}
        label="受付の開始日"
        type="date"
        value={draft.opensDate}
        error={errors.opensDate}
        onChange={(event) => setDraft({ ...draft, opensDate: event.target.value })}
      />
      <TextField
        id={`${idPrefix}-closes`}
        label="受付の締切日"
        type="date"
        value={draft.closesDate}
        error={errors.closesDate}
        hint="締切日の 23 時 59 分まで受け付けます"
        onChange={(event) => setDraft({ ...draft, closesDate: event.target.value })}
      />
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          checked={draft.autoApprove}
          onChange={(event) => setDraft({ ...draft, autoApprove: event.target.checked })}
          className="size-6"
        />
        <span className="font-semibold">承認を省く（申告がそのまま協会員になる）</span>
      </label>
    </>
  );
}
