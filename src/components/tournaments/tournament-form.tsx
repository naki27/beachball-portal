"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  parseTournamentInput,
  TOURNAMENT_DESCRIPTION_MAX,
  TOURNAMENT_NAME_MAX,
  TOURNAMENT_STATUS_LABEL,
  TOURNAMENT_STATUSES,
  TOURNAMENT_VENUE_MAX,
  type TournamentField,
} from "@/lib/tournaments/tournament-input";

// 画面が扱う値はすべて文字列（日付は "YYYY-MM-DD"）。数と日付への変換は parseTournamentInput に任せる
export type TournamentFormValues = {
  name: string;
  eventDate: string;
  ageReferenceDate: string;
  venue: string;
  description: string;
  entryStartDate: string;
  entryEndDate: string;
  teamSizeMin: string;
  teamSizeMax: string;
  maxEntries: string;
  status: string;
};

export const EMPTY_TOURNAMENT: TournamentFormValues = {
  name: "",
  eventDate: "",
  ageReferenceDate: "",
  venue: "",
  description: "",
  entryStartDate: "",
  entryEndDate: "",
  teamSizeMin: "4",
  teamSizeMax: "7",
  maxEntries: "",
  status: "draft",
};

type ApiBody = { redirectTo?: string; error?: { message?: string; field?: TournamentField } };

// 大会の作成・編集（設計書 §5.4・§4.2 #13）。時刻は入力しない（開始はその日の 0:00、締切はその日の 23:59:59）
// 年齢の基準日は、空のまま開催日を入れると開催日が入る（要項に合わせて変えてもらう・§14-21）
export function TournamentForm({
  slug,
  mode,
  tournamentId,
  initial,
  hasCategoryDeadlines = false,
}: {
  slug: string;
  mode: "create" | "edit";
  tournamentId?: string;
  initial: TournamentFormValues;
  // 部ごとの締切の上書きがある大会だけ「部の締切も大会に揃える」を出す（§5.4 追加仕様 2）
  hasCategoryDeadlines?: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<TournamentField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [syncDeadlines, setSyncDeadlines] = useState(false);

  function set<K extends keyof TournamentFormValues>(key: K, value: TournamentFormValues[K]) {
    setValues((v) => {
      const next = { ...v, [key]: value };
      // 開催日を入れたら、まだ空の年齢の基準日に同じ日を入れておく（§14-21）
      if (key === "eventDate" && !v.ageReferenceDate) next.ageReferenceDate = value;
      return next;
    });
    setSaved(false);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setNotice(null);
    setSaved(false);
    const parsed = parseTournamentInput(values);
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const url = mode === "create" ? `/api/${slug}/admin/tournaments` : `/api/${slug}/admin/tournaments/${tournamentId}`;
      const response = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, syncCategoryDeadlines: syncDeadlines }),
      });
      const body = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        if (mode === "create") {
          router.push(body?.redirectTo ?? `/${slug}/admin/tournaments`);
        } else {
          setSaved(true);
          setSyncDeadlines(false);
        }
        router.refresh();
        return;
      }
      if (body?.error?.field) {
        setErrors({ [body.error.field]: body.error.message ?? "入力を確かめてください" });
        setNotice(body.error.message ?? null);
      } else {
        setNotice(body?.error?.message ?? "保存できませんでした");
      }
    } catch {
      setNotice("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate data-hydrated={hydrated || undefined} className="flex flex-col gap-5">
      {notice ? <Message kind="error" title={notice} /> : null}
      {saved ? <Message kind="success" title="保存しました" /> : null}
      <TextField
        id="tournament-name"
        label="大会名"
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
        error={errors.name}
        maxLength={TOURNAMENT_NAME_MAX * 2}
        required
      />
      <TextField
        id="tournament-event-date"
        label="開催日（任意）"
        type="date"
        value={values.eventDate}
        onChange={(e) => set("eventDate", e.target.value)}
        error={errors.eventDate}
        hint="決まっていなければ空欄のままで構いません。"
      />
      <TextField
        id="tournament-venue"
        label="会場（任意）"
        value={values.venue}
        onChange={(e) => set("venue", e.target.value)}
        error={errors.venue}
        maxLength={TOURNAMENT_VENUE_MAX * 2}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tournament-description" className="font-semibold">
          説明（任意）
        </label>
        <textarea
          id="tournament-description"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          rows={5}
          maxLength={TOURNAMENT_DESCRIPTION_MAX}
          aria-describedby="tournament-description-hint"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
        />
        <p id="tournament-description-hint" className="text-sm text-muted">
          参加費や持ち物など、参加する方に伝えることを書いてください。
        </p>
      </div>

      <h2 className="mt-2 text-lg font-bold">申し込みの受付</h2>
      <TextField
        id="tournament-entry-start"
        label="申し込みの開始日（任意）"
        type="date"
        value={values.entryStartDate}
        onChange={(e) => set("entryStartDate", e.target.value)}
        error={errors.entryStartDate}
        hint="その日の 0 時から受け付けます。空欄なら、受付中にした時点から受け付けます。"
      />
      <TextField
        id="tournament-entry-end"
        label="締切日"
        type="date"
        value={values.entryEndDate}
        onChange={(e) => set("entryEndDate", e.target.value)}
        error={errors.entryEndDate}
        hint="その日の 23 時 59 分まで受け付けます。"
        required
      />
      {hasCategoryDeadlines ? (
        <label className="flex min-h-12 items-start gap-3">
          <input type="checkbox" checked={syncDeadlines} onChange={(e) => setSyncDeadlines(e.target.checked)} className="mt-1 size-5" />
          <span>
            <span className="font-semibold">部ごとの締切も大会に揃える</span>
            <span className="block text-sm text-muted">部だけ別に決めた締切を消して、すべての部を大会の締切にします。</span>
          </span>
        </label>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <TextField
          id="tournament-team-size-min"
          label="参加人数の下限"
          type="number"
          inputMode="numeric"
          min={1}
          value={values.teamSizeMin}
          onChange={(e) => set("teamSizeMin", e.target.value)}
          error={errors.teamSizeMin}
          required
        />
        <TextField
          id="tournament-team-size-max"
          label="参加人数の上限"
          type="number"
          inputMode="numeric"
          min={1}
          value={values.teamSizeMax}
          onChange={(e) => set("teamSizeMax", e.target.value)}
          error={errors.teamSizeMax}
          required
        />
      </div>
      <TextField
        id="tournament-max-entries"
        label="申し込みの上限（任意）"
        type="number"
        inputMode="numeric"
        min={1}
        value={values.maxEntries}
        onChange={(e) => set("maxEntries", e.target.value)}
        error={errors.maxEntries}
        hint="空欄なら上限なし。部ごとの上限は部の設定で決めます。"
      />
      <TextField
        id="tournament-age-reference"
        label="年齢の基準日"
        type="date"
        value={values.ageReferenceDate}
        onChange={(e) => set("ageReferenceDate", e.target.value)}
        error={errors.ageReferenceDate}
        hint="この日の年齢で部の資格を判定します。既定は開催日です。要項に合わせて変えてください。"
        required
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tournament-status" className="font-semibold">
          公開の状態
        </label>
        <select
          id="tournament-status"
          value={values.status}
          onChange={(e) => set("status", e.target.value)}
          aria-describedby="tournament-status-hint"
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          {TOURNAMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {TOURNAMENT_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        <p id="tournament-status-hint" className="text-sm text-muted">
          「受付中」にすると、開始日から締切日まで申し込めます。「受付を終了」にすると、締切日より前でも申し込めなくなります。
        </p>
        {errors.status ? <p className="text-sm font-semibold text-danger">{errors.status}</p> : null}
      </div>

      <Button type="submit" fullWidth pending={pending} pendingLabel={mode === "create" ? "作っています…" : "保存しています…"}>
        {mode === "create" ? "大会を作る" : "保存する"}
      </Button>
    </form>
  );
}
