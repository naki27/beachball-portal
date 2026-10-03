"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionBar, Card } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { useHydrated } from "@/hooks/use-hydrated";
import { emptyPeriodValues, PeriodFields, periodClientErrors, type PeriodValues } from "./period-fields";

type PeriodApiBody = { period?: { id?: string }; error?: { message?: string; field?: string } };

// 年度更新の受付を開始するページ（設計書 §5.12「受付開始」・§4.3「一覧と登録はページを分ける」）
export function PeriodNewForm({ slug, defaultYear }: { slug: string; defaultYear: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const listUrl = `/${slug}/admin/memberships`;
  const [values, setValues] = useState<PeriodValues>(emptyPeriodValues(defaultYear));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    if (pending) return;
    const next = periodClientErrors(values);
    setErrors(next);
    setNotice(null);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    try {
      const response = await fetch(`/api/${slug}/admin/memberships/periods`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          year: Number(values.year),
          opensDate: values.opensDate,
          closesDate: values.closesDate,
          autoApprove: values.autoApprove,
        }),
      });
      // 本文は 1 回しか読めないので、成功と失敗の両方をここから取る
      const body = (await response.json().catch(() => null)) as PeriodApiBody | null;
      if (response.ok) {
        router.push(`${listUrl}?added=${encodeURIComponent(body?.period?.id ?? "")}#periods`);
        return;
      }
      const message = body?.error?.message ?? "受付を開始できませんでした";
      if (body?.error?.field) setErrors({ [body.error.field]: message });
      else setNotice(message);
    } catch {
      setNotice("受付を開始できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {notice ? <Message kind="error" title={notice} /> : null}
      <Card className="flex flex-col gap-4">
        <PeriodFields idPrefix="period-new" values={values} errors={errors} onChange={setValues} yearLocked={false} />
      </Card>
      <ActionBar>
        <Button pending={pending} pendingLabel="開始しています…" onClick={() => void submit()} fullWidth>
          受付を開始する
        </Button>
        <Button variant="secondary" onClick={() => router.push(listUrl)} fullWidth>
          やめる
        </Button>
      </ActionBar>
    </div>
  );
}
