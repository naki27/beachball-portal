"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { parseTeamInput, TEAM_KANA_MAX, TEAM_NAME_MAX, type TeamField } from "@/lib/teams/team-input";

export type TeamFormValues = {
  name: string;
  kana: string;
  contactEmail: string;
  contactPhone: string;
  membershipRenewalTarget: boolean;
};

type SameName = { count: number; mine: { id: string; name: string }[] };
type ApiBody = {
  redirectTo?: string;
  error?: { message?: string; field?: TeamField; sameName?: SameName };
};

// チームで登録・チーム情報の編集（設計書 §5.11「チームの作り方」）。チーム名だけで登録できる
// mode = create: POST /api/[slug]/teams。同名のチームがあれば警告し、「別のチームとして登録する」で作る
// mode = edit: PATCH /api/[slug]/teams/[teamId]
export function TeamForm({
  slug,
  mode,
  teamId,
  initial,
}: {
  slug: string;
  mode: "create" | "edit";
  teamId?: string;
  initial: TeamFormValues;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<TeamField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sameName, setSameName] = useState<SameName | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof TeamFormValues>(key: K, value: TeamFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (key === "name") setSameName(null);
  }

  async function send(confirmSameName: boolean) {
    if (pending) return;
    setNotice(null);
    const parsed = parseTeamInput(values);
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const url = mode === "create" ? `/api/${slug}/teams` : `/api/${slug}/teams/${teamId}`;
      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...parsed.value, confirmSameName }),
      });
      const body = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        router.push(mode === "create" ? (body?.redirectTo ?? `/${slug}`) : `/${slug}/teams/${teamId}?updated=1`);
        router.refresh();
        return;
      }
      if (response.status === 409 && body?.error?.sameName) {
        setSameName(body.error.sameName);
      } else if (body?.error?.field) {
        setErrors({ [body.error.field]: body.error.message ?? "入力を確かめてください" });
      } else {
        setNotice(body?.error?.message ?? "送信できませんでした");
      }
    } catch {
      setNotice("送信できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate data-hydrated={hydrated || undefined} className="flex flex-col gap-5">
      {notice ? <Message kind="error" title={notice} /> : null}
      <TextField
        id="team-name"
        label="チーム名"
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
        error={errors.name}
        maxLength={TEAM_NAME_MAX * 2}
        autoComplete="organization"
        required
      />
      {sameName ? (
        <Message kind="info" title={`同じ名前のチームが${sameName.count}チームあります`}>
          <div className="flex flex-col gap-3">
            {sameName.mine.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {sameName.mine.map((t) => (
                  <li key={t.id}>
                    あなたが代表者を務める
                    <Link href={`/${slug}/teams/${t.id}`} className="font-semibold underline underline-offset-2">
                      {t.name}
                    </Link>
                    があります
                  </li>
                ))}
              </ul>
            ) : (
              <p>同じチームを二重に登録していないか確かめてください。</p>
            )}
            <Button variant="secondary" onClick={() => void send(true)} pending={pending} pendingLabel="登録しています…">
              別のチームとして登録する
            </Button>
          </div>
        </Message>
      ) : null}
      <TextField
        id="team-kana"
        label="チーム名のふりがな（任意）"
        value={values.kana}
        onChange={(e) => set("kana", e.target.value)}
        error={errors.kana}
        maxLength={TEAM_KANA_MAX * 2}
      />
      <TextField
        id="team-email"
        label="代表者の連絡先メールアドレス（任意）"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={values.contactEmail}
        onChange={(e) => set("contactEmail", e.target.value)}
        error={errors.contactEmail}
      />
      <TextField
        id="team-phone"
        label="代表者の連絡先電話番号（任意）"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={values.contactPhone}
        onChange={(e) => set("contactPhone", e.target.value)}
        error={errors.contactPhone}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="team-renewal" className="flex min-h-12 items-center gap-3 font-semibold">
          <input
            id="team-renewal"
            type="checkbox"
            className="size-6 shrink-0 accent-[var(--color-primary)]"
            checked={values.membershipRenewalTarget}
            onChange={(e) => set("membershipRenewalTarget", e.target.checked)}
            aria-describedby="team-renewal-hint"
          />
          協会員の登録をするチーム
        </label>
        <p id="team-renewal-hint" className="text-sm text-muted">
          チームとして協会員の登録（毎年の更新）をする場合に入れてください。大会のために集まったチームは外したままで構いません。あとから変えられます。
        </p>
      </div>
      <Button type="submit" fullWidth pending={pending && !sameName} pendingLabel={mode === "create" ? "登録しています…" : "保存しています…"}>
        {mode === "create" ? "登録する" : "保存する"}
      </Button>
    </form>
  );
}
