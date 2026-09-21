"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionBar, Card } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { type PeriodField, parsePeriodInput } from "@/lib/memberships/period-input";
import { type PeriodApiBody, type PeriodDraft, PeriodFields } from "./period-fields";

// 年度更新の受付を始めるページ（設計書 §5.12・§4.3「一覧と登録はページを分ける」）
export function PeriodOpenForm({ slug, defaultYear }: { slug: string; defaultYear: number }) {
  const router = useRouter();
  const listUrl = `/${slug}/admin/memberships`;
  const [draft, setDraft] = useState<PeriodDraft>({
    year: String(defaultYear),
    opensDate: "",
    closesDate: "",
    autoApprove: false,
  });
  const [errors, setErrors] = useState<Partial<Record<PeriodField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    if (pending) return;
    setErrors({});
    setNotice(null);
    const parsed = parsePeriodInput(draft);
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/${slug}/admin/memberships`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json().catch(() => null)) as PeriodApiBody | null;
      if (response.ok) {
        router.push(`${listUrl}?opened=${encodeURIComponent(draft.year)}`);
        return;
      }
      if (body?.error?.field) setErrors({ [body.error.field]: body.error.message ?? "入力を確かめてください" });
      setNotice(body?.error?.message ?? "保存できませんでした");
    } catch {
      setNotice("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Message kind="error" title={notice} /> : null}
      <Card className="flex flex-col gap-3">
        <PeriodFields draft={draft} setDraft={setDraft} errors={errors} idPrefix="new" showYear />
      </Card>
      <p className="text-sm text-muted">
        受付を始めると、協会員の登録をするチームの代表者に案内が出ます（メールの一斉送信は、いまは行いません）。
      </p>
      <ActionBar>
        <Button pending={pending} pendingLabel="始めています…" onClick={() => void submit()} fullWidth>
          受付を始める
        </Button>
        <Button variant="secondary" onClick={() => router.push(listUrl)} fullWidth>
          やめる
        </Button>
      </ActionBar>
    </div>
  );
}
