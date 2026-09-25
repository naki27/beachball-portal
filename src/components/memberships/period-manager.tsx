"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import type { PeriodState } from "@/lib/admin/membership-periods";
import { fiscalYearLabel } from "@/lib/memberships/period-input";

// 年度更新の受付の開始と変更（設計書 §5.12「受付開始」）。対象年度・受付期間（日付）・承認を省くか

export type PeriodRowView = {
  id: string;
  year: number;
  opensDate: string;
  closesDate: string;
  periodText: string;
  autoApprove: boolean;
  state: PeriodState;
  targetTeams: number;
  declaredTeams: number;
};

type ApiError = { error?: { message?: string; field?: string } };
type Values = { year: string; opensDate: string; closesDate: string; autoApprove: boolean };

const STATE_LABEL: Record<PeriodState, string> = { before: "受付前", open: "受付中", closed: "締切後" };

async function readError(response: Response, fallback: string): Promise<{ message: string; field: string | null }> {
  const body = (await response.json().catch(() => null)) as ApiError | null;
  return { message: body?.error?.message ?? fallback, field: body?.error?.field ?? null };
}

function clientErrors(values: Values): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}$/.test(values.year.trim())) errors.year = "対象年度を西暦の 4 けたで入力してください";
  if (!values.opensDate) errors.opensDate = "受付の開始日を入力してください";
  if (!values.closesDate) errors.closesDate = "受付の締切日を入力してください";
  if (values.opensDate && values.closesDate && values.closesDate < values.opensDate) errors.closesDate = "締切日は開始日以降にしてください";
  return errors;
}

function PeriodFields({
  idPrefix,
  values,
  errors,
  onChange,
  yearLocked,
}: {
  idPrefix: string;
  values: Values;
  errors: Record<string, string>;
  onChange: (next: Values) => void;
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
        <input type="checkbox" checked={values.autoApprove} onChange={(e) => onChange({ ...values, autoApprove: e.target.checked })} className="mt-1 size-5" />
        <span>
          承認を省く
          <span className="block text-sm text-muted">代表者が申告した人をそのまま協会員にします（追加の申告は承認が必要なままです）</span>
        </span>
      </label>
    </>
  );
}

export function PeriodManager({ slug, defaultYear, periods }: { slug: string; defaultYear: string; periods: PeriodRowView[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [values, setValues] = useState<Values>({ year: defaultYear, opensDate: "", closesDate: "", autoApprove: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const next = clientErrors(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    setDone(null);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/admin/memberships/periods`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year: Number(values.year), opensDate: values.opensDate, closesDate: values.closesDate, autoApprove: values.autoApprove }),
      });
      if (!response.ok) {
        const error = await readError(response, "受付を開始できませんでした");
        if (error.field) setErrors({ [error.field]: error.message });
        else setFailure(error.message);
        return;
      }
      setDone(`${fiscalYearLabel(Number(values.year))}の受付を開始しました`);
      setValues({ year: String(Number(values.year) + 1), opensDate: "", closesDate: "", autoApprove: false });
      router.refresh();
    } catch {
      setFailure("受付を開始できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-8">
      <form onSubmit={submit} noValidate aria-labelledby="period-open" className="flex flex-col gap-4">
        <h2 id="period-open" className="text-lg font-bold">
          受付を開始する
        </h2>
        {done ? <Message kind="success" title={done} /> : null}
        {failure ? <Message kind="error" title={failure} /> : null}
        <PeriodFields idPrefix="period-new" values={values} errors={errors} onChange={setValues} yearLocked={false} />
        <Button type="submit" className="self-start" pending={pending} pendingLabel="開始しています…">
          受付を開始する
        </Button>
      </form>

      <section aria-labelledby="period-list" className="flex flex-col gap-3">
        <h2 id="period-list" className="text-lg font-bold">
          年度ごとの受付
        </h2>
        {periods.length === 0 ? (
          <p className="text-sm text-muted">まだ受付を開始した年度はありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {periods.map((p) => (
              <li key={p.id}>
                <PeriodRow slug={slug} period={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PeriodRow({ slug, period }: { slug: string; period: PeriodRowView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values>({
    year: String(period.year),
    opensDate: period.opensDate,
    closesDate: period.closesDate,
    autoApprove: period.autoApprove,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function cancel() {
    setValues({ year: String(period.year), opensDate: period.opensDate, closesDate: period.closesDate, autoApprove: period.autoApprove });
    setErrors({});
    setFailure(null);
    setEditing(false);
  }

  async function save() {
    if (pending) return;
    const next = clientErrors(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/${slug}/admin/memberships/periods/${period.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ year: period.year, opensDate: values.opensDate, closesDate: values.closesDate, autoApprove: values.autoApprove }),
      });
      if (!response.ok) {
        const error = await readError(response, "保存できませんでした");
        if (error.field) setErrors({ [error.field]: error.message });
        else setFailure(error.message);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setFailure("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-bold">{fiscalYearLabel(period.year)}</p>
        <span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${period.state === "open" ? "bg-success-surface text-success" : "bg-surface text-muted"}`}>
          {STATE_LABEL[period.state]}
        </span>
      </div>
      <p className="text-sm">受付期間: {period.periodText}</p>
      <p className="text-sm">承認: {period.autoApprove ? "省く（申告をそのまま協会員にする）" : "運営が確認して承認する"}</p>
      <p className="text-sm text-muted">
        対象チーム {period.targetTeams} のうち申告済み {period.declaredTeams}
      </p>
      {failure ? <p className="text-sm font-semibold text-danger">{failure}</p> : null}
      {editing ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <PeriodFields idPrefix={`period-${period.id}`} values={values} errors={errors} onChange={setValues} yearLocked />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-10" onClick={save} pending={pending} pendingLabel="保存しています…">
              保存する
            </Button>
            <Button variant="secondary" className="min-h-10" onClick={cancel} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="min-h-10 self-start" onClick={() => setEditing(true)}>
          期間・承認の設定を変える
        </Button>
      )}
    </div>
  );
}
