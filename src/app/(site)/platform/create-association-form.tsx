"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";

type ApiError = { error?: { message?: string; field?: string } };

// テナントの作成（§5.14「テナントの作成」）: 協会名・URL の名前・年度の開始月・連絡先・最初の管理者のメールアドレス
export function CreateAssociationForm() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [month, setMonth] = useState("4");
  const [contactEmail, setContactEmail] = useState("");
  const [adminEmails, setAdminEmails] = useState("");
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
      const response = await fetch("/api/platform/associations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          fiscalYearStartMonth: Number(month),
          contactEmail: contactEmail || null,
          adminEmails: adminEmails.split(/[\s,、]+/).filter(Boolean),
        }),
      });
      const body = (await response.json().catch(() => null)) as (ApiError & { association?: { name: string } }) | null;
      if (response.ok) {
        setNotice({ kind: "success", title: `${body?.association?.name ?? "協会"}を作りました。最初の管理者に招待のメールを送ります` });
        setName("");
        setSlug("");
        setContactEmail("");
        setAdminEmails("");
        router.refresh();
      } else if (body?.error?.field) {
        setErrors({ [body.error.field]: body.error.message ?? "入力を確かめてください" });
      } else {
        setNotice({ kind: "error", title: body?.error?.message ?? "作れませんでした" });
      }
    } catch {
      setNotice({ kind: "error", title: "作れませんでした。電波の状態を確かめてください" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate data-hydrated={hydrated || undefined} className="flex flex-col gap-4">
      {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
      <TextField id="assoc-name" label="協会名" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} required />
      <TextField
        id="assoc-slug"
        label="URL の名前（英小文字・数字・ハイフン、3〜30 文字）"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        error={errors.slug}
        hint="例: sawara → https://…/sawara/"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <TextField
        id="assoc-month"
        label="年度の開始月"
        inputMode="numeric"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        error={errors.fiscalYearStartMonth}
      />
      <TextField
        id="assoc-contact"
        label="協会の連絡先メールアドレス（任意）"
        type="email"
        inputMode="email"
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
        error={errors.contactEmail}
      />
      <TextField
        id="assoc-admins"
        label="最初の管理者のメールアドレス（1 名以上。複数はカンマで区切る）"
        type="email"
        inputMode="email"
        value={adminEmails}
        onChange={(e) => setAdminEmails(e.target.value)}
        error={errors.adminEmails}
        required
      />
      <Button type="submit" pending={pending} pendingLabel="作っています…" fullWidth>
        協会を作る
      </Button>
    </form>
  );
}
