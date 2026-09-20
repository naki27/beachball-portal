"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { parsePeriodInput, type PeriodField } from "@/lib/memberships/period-input";

// 年度更新の受付（設計書 §5.12「受付開始」）。テナント管理者だけ
// 画面には「来年度」「次年度」と書かず、年度の数字で書く（§4.4）

export type PeriodRow = {
  year: number;
  // 「2027年度」
  yearText: string;
  opensDate: string; // YYYY-MM-DD（入力欄の値）
  closesDate: string;
  autoApprove: boolean;
  // 「4月1日（木）から」「6月30日（水）まで　あと5日」など
  periodText: string;
  stateText: string;
  targetTeams: number;
  declaredTeams: number;
};

type Draft = { year: string; opensDate: string; closesDate: string; autoApprove: boolean };

type ApiBody = { error?: { message?: string; field?: PeriodField } };

export function PeriodManager({ slug, periods, nextYear }: { slug: string; periods: PeriodRow[]; nextYear: number }) {
  const router = useRouter();
  const base = `/api/${slug}/admin/memberships`;
  const empty: Draft = { year: String(nextYear), opensDate: "", closesDate: "", autoApprove: false };
  const [draft, setDraft] = useState<Draft>(empty);
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PeriodField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function send(key: string, url: string, method: string, body: unknown, message: string): Promise<void> {
    if (pending) return;
    setErrors({});
    setNotice(null);
    setDone(null);
    setPending(key);
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const parsedBody = (await response.json().catch(() => null)) as ApiBody | null;
      if (response.ok) {
        setDone(message);
        setEditingYear(null);
        setDraft(empty);
        router.refresh();
        return;
      }
      if (parsedBody?.error?.field) setErrors({ [parsedBody.error.field]: parsedBody.error.message ?? "入力を確かめてください" });
      setNotice(parsedBody?.error?.message ?? "保存できませんでした");
    } catch {
      setNotice("保存できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(null);
    }
  }

  function submit(kind: "open" | "edit", year?: number): void {
    const parsed = parsePeriodInput(kind === "open" ? draft : { ...draft, year: String(year) });
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    if (kind === "open") void send("open", base, "POST", draft, `${draft.year}年度の受付を始めました`);
    else void send(`edit:${year}`, `${base}/${year}`, "PATCH", draft, `${year}年度の受付を保存しました`);
  }

  function startEdit(row: PeriodRow): void {
    setErrors({});
    setNotice(null);
    setDone(null);
    setEditingYear(row.year);
    setDraft({ year: String(row.year), opensDate: row.opensDate, closesDate: row.closesDate, autoApprove: row.autoApprove });
  }

  return (
    <section className="flex flex-col gap-4">
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      <ul className="flex flex-col gap-3">
        {periods.map((row) => (
          <li key={row.year} className="flex flex-col gap-2 rounded-md border border-border p-3">
            {editingYear === row.year ? (
              <>
                <p className="font-bold">{row.yearText}の受付</p>
                <PeriodFields draft={draft} setDraft={setDraft} errors={errors} idPrefix={`edit-${row.year}`} showYear={false} />
                <div className="flex flex-wrap gap-2">
                  <Button pending={pending === `edit:${row.year}`} pendingLabel="保存しています…" onClick={() => submit("edit", row.year)}>
                    保存する
                  </Button>
                  <Button variant="secondary" onClick={() => setEditingYear(null)}>
                    やめる
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-lg font-bold">{row.yearText}</span>
                  <span className="text-sm font-semibold">{row.stateText}</span>
                </div>
                <p className="text-sm">{row.periodText}</p>
                <p className="text-sm text-muted">
                  協会員の登録をするチーム {row.targetTeams} 組のうち、申告が届いているのは {row.declaredTeams} 組
                  {row.autoApprove ? "・承認を省く設定です" : ""}
                </p>
                <div>
                  <Button variant="secondary" onClick={() => startEdit(row)}>
                    受付の期間を直す
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
        {periods.length === 0 ? <li className="text-muted">まだ受付を始めた年度はありません。</li> : null}
      </ul>

      {editingYear === null ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <h2 className="font-bold">受付を始める</h2>
          <PeriodFields draft={draft} setDraft={setDraft} errors={errors} idPrefix="new" showYear />
          <Button pending={pending === "open"} pendingLabel="始めています…" onClick={() => submit("open")} fullWidth>
            受付を始める
          </Button>
          <p className="text-sm text-muted">
            受付を始めると、協会員の登録をするチームの代表者に案内が出ます（メールの一斉送信は、いまは行いません）。
          </p>
        </div>
      ) : null}
    </section>
  );
}

function PeriodFields({
  draft,
  setDraft,
  errors,
  idPrefix,
  showYear,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  errors: Partial<Record<PeriodField, string>>;
  idPrefix: string;
  showYear: boolean;
}) {
  return (
    <>
      {showYear ? (
        <TextField
          id={`${idPrefix}-year`}
          label="年度"
          inputMode="numeric"
          value={draft.year}
          error={errors.year}
          hint="4 月から始まる年度の、始まる年の数（2027年度なら 2027）"
          onChange={(event) => setDraft({ ...draft, year: event.target.value })}
        />
      ) : null}
      <TextField
        id={`${idPrefix}-opens`}
        label="受付の開始日"
        type="date"
        value={draft.opensDate}
        error={errors.opensDate}
        onChange={(event) => setDraft({ ...draft, opensDate: event.target.value })}
      />
      <TextField
        id={`${idPrefix}-closes`}
        label="受付の締切日"
        type="date"
        value={draft.closesDate}
        error={errors.closesDate}
        hint="締切日の 23 時 59 分まで受け付けます"
        onChange={(event) => setDraft({ ...draft, closesDate: event.target.value })}
      />
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          checked={draft.autoApprove}
          onChange={(event) => setDraft({ ...draft, autoApprove: event.target.checked })}
          className="size-6"
        />
        <span className="font-semibold">承認を省く（申告がそのまま協会員になる）</span>
      </label>
    </>
  );
}
