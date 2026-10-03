"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, Toolbar } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";
import type { PeriodState } from "@/lib/admin/membership-periods";
import { fiscalYearLabel } from "@/lib/memberships/period-input";
import { PeriodFields, periodClientErrors, type PeriodValues, readPeriodError } from "./period-fields";

// 年度更新の受付の一覧（設計書 §5.12「受付開始」）。受付を開始するのは別のページ（§4.3「一覧と登録はページを分ける」）
// 期間・承認の設定の変更は、年度を変えられないので行の中で直す

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

const STATE_LABEL: Record<PeriodState, string> = { before: "受付前", open: "受付中", closed: "締切後" };
const STATE_TONE: Record<PeriodState, "success" | "neutral"> = { before: "neutral", open: "success", closed: "neutral" };

export function PeriodManager({
  slug,
  periods,
  addedId = null,
}: {
  slug: string;
  periods: PeriodRowView[];
  addedId?: string | null;
}) {
  const hydrated = useHydrated();
  const newUrl = `/${slug}/admin/memberships/new`;
  const added = addedId ? periods.find((row) => row.id === addedId) : undefined;

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {added ? <Message kind="success" title={`${fiscalYearLabel(added.year)}の受付を開始しました`} /> : null}

      {periods.length > 0 ? (
        <Toolbar>
          <span className="text-sm font-semibold">{periods.length} 件</span>
          <Link href={newUrl} className={`${buttonClass("primary", false, "sm")} ml-auto`}>
            受付を開始する
          </Link>
        </Toolbar>
      ) : null}

      {periods.length === 0 ? (
        <EmptyState
          title="まだ受付を開始した年度はありません"
          description="受付を開始すると、対象チームの代表者に案内が出ます。"
          action={
            <Link href={newUrl} className={buttonClass()}>
              受付を開始する
            </Link>
          }
        />
      ) : (
        <ul className="bb-stagger flex flex-col gap-3">
          {periods.map((period) => (
            <li key={period.id}>
              <PeriodRow slug={slug} period={period} highlighted={period.id === addedId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PeriodRow({ slug, period, highlighted }: { slug: string; period: PeriodRowView; highlighted: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<PeriodValues>({
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
    const next = periodClientErrors(values);
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
        const error = await readPeriodError(response, "保存できませんでした");
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
    <Card className={`flex flex-col gap-2 ${highlighted ? "bb-highlight" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-bold">{fiscalYearLabel(period.year)}</p>
        <Badge tone={STATE_TONE[period.state]}>{STATE_LABEL[period.state]}</Badge>
      </div>
      <p className="text-sm">受付期間: {period.periodText}</p>
      <p className="text-sm">承認: {period.autoApprove ? "省く（申告をそのまま協会員にする）" : "運営が確認して承認する"}</p>
      <p className="text-sm text-muted">
        対象チーム {period.targetTeams} のうち申告済み {period.declaredTeams}
      </p>
      <p className="text-sm">
        <Link href={`/${slug}/admin/memberships/${period.year}`} className="bb-link font-semibold text-primary">
          申告の状況を見る（未申告・承認）
        </Link>
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
    </Card>
  );
}
