"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";

type Initial = { name: string; slug: string; contactEmail: string };

// 協会名・スラッグ・連絡先の変更（§5.14）。スラッグは原則変えない（変えると旧スラッグからの転送が残る）
export function AssociationSettingsForm({ associationId, initial }: { associationId: string; initial: Initial }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [values, setValues] = useState<Initial>(initial);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "success" | "error"; title: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setNotice(null);
    try {
      const response = await fetch(`/api/platform/associations/${associationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string; field?: string } } | null;
      if (response.ok) {
        setNotice({ kind: "success", title: "保存しました" });
        router.refresh();
      } else if (body?.error?.field) {
        setErrors({ [body.error.field]: body.error.message ?? "入力を確かめてください" });
      } else {
        setNotice({ kind: "error", title: body?.error?.message ?? "保存できませんでした" });
      }
    } catch {
      setNotice({ kind: "error", title: "保存できませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      <TextField
        id="settings-name"
        label="協会名"
        value={values.name}
        onChange={(e) => setValues({ ...values, name: e.target.value })}
        error={errors.name}
      />
      <TextField
        id="settings-slug"
        label="URL の名前"
        value={values.slug}
        onChange={(e) => setValues({ ...values, slug: e.target.value })}
        error={errors.slug}
        hint="変えると、以前の URL は新しい URL へ自動で転送されます。共有済みの URL や印刷物があるときは慎重に"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <TextField
        id="settings-contact"
        label="協会の連絡先メールアドレス（任意）"
        type="email"
        inputMode="email"
        value={values.contactEmail}
        onChange={(e) => setValues({ ...values, contactEmail: e.target.value })}
        error={errors.contactEmail}
      />
      <Button type="submit" pending={pending} pendingLabel="保存しています…" fullWidth>
        保存する
      </Button>
    </form>
  );
}
