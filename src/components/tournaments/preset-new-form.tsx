"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionBar, Card } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { type PresetField, parsePresetInput } from "@/lib/presets/preset-input";
import { EMPTY_PRESET_DRAFT, type PresetApiBody, type PresetDraft, PresetFields } from "./preset-fields";

// 「よく使う部」を足すページ（設計書 §5.4・§4.3「一覧と登録はページを分ける」）
export function PresetNewForm({ slug }: { slug: string }) {
  const router = useRouter();
  const listUrl = `/${slug}/admin/association`;
  const [draft, setDraft] = useState<PresetDraft>(EMPTY_PRESET_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<PresetField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    if (pending) return;
    setErrors({});
    setNotice(null);
    const parsed = parsePresetInput(draft);
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/${slug}/admin/category-presets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await response.json().catch(() => null)) as PresetApiBody | null;
      if (response.ok) {
        router.push(`${listUrl}?added=${encodeURIComponent(body?.preset?.id ?? "")}#presets`);
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
      <Card>
        <PresetFields draft={draft} setDraft={setDraft} errors={errors} idPrefix="preset-new" withCode />
      </Card>
      <ActionBar>
        <Button pending={pending} pendingLabel="追加しています…" onClick={() => void submit()} fullWidth>
          追加する
        </Button>
        <Button variant="secondary" onClick={() => router.push(listUrl)} fullWidth>
          やめる
        </Button>
      </ActionBar>
    </div>
  );
}
