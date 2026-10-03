"use client";

import { TextField } from "@/components/ui/text-field";

// 年度更新の受付の入力欄（設計書 §5.12「受付開始」）。受付を開始するページと、一覧の行の編集で共用する

export type PeriodValues = { year: string; opensDate: string; closesDate: string; autoApprove: boolean };

type ApiError = { error?: { message?: string; field?: string } };

export function emptyPeriodValues(year: string): PeriodValues {
  return { year, opensDate: "", closesDate: "", autoApprove: false };
}

export async function readPeriodError(response: Response, fallback: string): Promise<{ message: string; field: string | null }> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return { message: body?.error?.message ?? fallback, field: body?.error?.field ?? null };
}

export function periodClientErrors(values: PeriodValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}$/.test(values.year.trim())) errors.year = "対象年度を西暦の 4 けたで入力してください";
  if (!values.opensDate) errors.opensDate = "受付の開始日を入力してください";
  if (!values.closesDate) errors.closesDate = "受付の締切日を入力してください";
  if (values.opensDate && values.closesDate && values.closesDate < values.opensDate) errors.closesDate = "締切日は開始日以降にしてください";
  return errors;
}

export function PeriodFields({
  idPrefix,
  values,
  errors,
  onChange,
  yearLocked,
}: {
  idPrefix: string;
  values: PeriodValues;
  errors: Record<string, string>;
  onChange: (next: PeriodValues) => void;
  yearLocked: boolean;
}) {
  return (
    <>
      <TextField
        id={`${idPrefix}-year`}
        label="対象年度（西暦）"
        value={values.year}
        inputMode="numeric"
        maxLength={4}
        disabled={yearLocked}
        onChange={(e) => onChange({ ...values, year: e.target.value })}
        error={errors.year}
        hint={yearLocked ? "年度は変えられません" : "例: 2027（2027年度 = 2027年4月〜2028年3月）"}
        className="max-w-40"
      />
      <TextField
        id={`${idPrefix}-opens`}
        label="受付の開始日"
        type="date"
        value={values.opensDate}
        onChange={(e) => onChange({ ...values, opensDate: e.target.value })}
        error={errors.opensDate}
        hint="その日の 0 時から受け付けます"
      />
      <TextField
        id={`${idPrefix}-closes`}
        label="受付の締切日"
        type="date"
        value={values.closesDate}
        onChange={(e) => onChange({ ...values, closesDate: e.target.value })}
        error={errors.closesDate}
        hint="その日の 23 時 59 分まで受け付けます。締切後も、年度の末日までは追加の申告を送れます"
      />
      <label className="flex min-h-12 items-start gap-3">
        <input
          type="checkbox"
          checked={values.autoApprove}
          onChange={(e) => onChange({ ...values, autoApprove: e.target.checked })}
          className="mt-1 size-5"
        />
        <span>
          承認を省く
          <span className="block text-sm text-muted">代表者が申告した人をそのまま協会員にします（追加の申告は承認が必要なままです）</span>
        </span>
      </label>
    </>
  );
}
