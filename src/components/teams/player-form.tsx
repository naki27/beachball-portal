"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { type BirthDateValue, BirthDateField } from "@/components/ui/birth-date-field";
import { Button } from "@/components/ui/button";
import { ErrorSummary, type FieldError } from "@/components/ui/error-summary";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { todayInTokyo } from "@/lib/date";
import { parsePlayerInput, PLAYER_KANA_MAX, PLAYER_NAME_MAX, type PlayerField, SEX_CHOICES } from "@/lib/teams/player-input";

export type PlayerFormValues = { name: string; kana: string; birthDate: string | null; sex: "male" | "female" | "" };

type ApiBody = { error?: { message?: string; field?: PlayerField } };

const FIELD_LABEL: Record<PlayerField, string> = { name: "氏名", kana: "ふりがな", birthDate: "生年月日", sex: "性別" };
const FIELD_ID: Record<PlayerField, string> = { name: "player-name", kana: "player-kana", birthDate: "player-birth-year", sex: "player-sex-male" };

// 選手の追加・修正（設計書 §5.11「名簿の管理」）。本人の情報を入力する（サジェストは使わない）
// 生年月日の部品が「◯歳で合っていますか？」を出している間は送れない（§4.3）
export function PlayerForm({
  slug,
  teamId,
  mode,
  teamMemberId,
  initial,
}: {
  slug: string;
  teamId: string;
  mode: "create" | "edit";
  teamMemberId?: string;
  initial: PlayerFormValues;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [values, setValues] = useState(initial);
  const [birth, setBirth] = useState<BirthDateValue>({ date: initial.birthDate, ready: !!initial.birthDate });
  const [errors, setErrors] = useState<Partial<Record<PlayerField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof PlayerFormValues>(key: K, value: PlayerFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setNotice(null);
    const parsed = parsePlayerInput({ ...values, birthDate: birth.date }, todayInTokyo());
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    if (!birth.ready) {
      setErrors({ birthDate: "年齢を確かめてください（「はい、合っています」を押してください）" });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const url = mode === "create" ? `/api/${slug}/teams/${teamId}/members` : `/api/${slug}/teams/${teamId}/members/${teamMemberId}`;
      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.value),
      });
      const body = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        router.push(`/${slug}/teams/${teamId}/members?${mode === "create" ? "added" : "updated"}=1`);
        router.refresh();
        return;
      }
      if (body?.error?.field) {
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

  const summary: FieldError[] = (Object.keys(errors) as PlayerField[]).map((field) => ({
    id: FIELD_ID[field],
    label: FIELD_LABEL[field],
    message: errors[field] ?? "",
  }));

  return (
    <form onSubmit={onSubmit} noValidate data-hydrated={hydrated || undefined} className="flex flex-col gap-5">
      {notice ? <Message kind="error" title={notice} /> : null}
      <ErrorSummary errors={summary} />
      <TextField
        id="player-name"
        label="氏名"
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
        error={errors.name}
        maxLength={PLAYER_NAME_MAX * 2}
        autoComplete="off"
        required
      />
      <TextField
        id="player-kana"
        label="ふりがな（任意）"
        value={values.kana}
        onChange={(e) => set("kana", e.target.value)}
        error={errors.kana}
        maxLength={PLAYER_KANA_MAX * 2}
        autoComplete="off"
      />
      <BirthDateField id="player-birth" initialDate={initial.birthDate} onChange={setBirth} error={errors.birthDate} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-semibold">性別</legend>
        <div role="radiogroup" aria-label="性別" className="grid grid-cols-2 gap-2">
          {SEX_CHOICES.map((choice) => (
            <label
              key={choice.id}
              className="bb-pressable flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-border bg-background font-semibold has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-focus)]"
            >
              <input
                id={`player-sex-${choice.id}`}
                type="radio"
                name="player-sex"
                value={choice.id}
                checked={values.sex === choice.id}
                onChange={() => set("sex", choice.id)}
                className="sr-only"
              />
              {choice.label}
            </label>
          ))}
        </div>
        {errors.sex ? (
          <p className="text-sm font-semibold text-danger" role="alert">
            {errors.sex}
          </p>
        ) : null}
      </fieldset>
      <Button type="submit" fullWidth pending={pending} pendingLabel={mode === "create" ? "追加しています…" : "保存しています…"}>
        {mode === "create" ? "選手一覧に追加する" : "保存する"}
      </Button>
    </form>
  );
}
