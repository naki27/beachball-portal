"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, Card, EmptyState, Toolbar } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { type PeriodField, parsePeriodInput } from "@/lib/memberships/period-input";
import { type PeriodApiBody, type PeriodDraft, PeriodFields } from "./period-fields";

// 年度更新の受付の一覧（設計書 §5.12「受付開始」）。テナント管理者だけ
// 受付を始めるのは別のページ（…/memberships/new・§4.3「一覧と登録はページを分ける」）
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

const STATE_TONE: Record<string, "brand" | "neutral"> = { 受付中: "brand" };

export function PeriodManager({
  slug,
  periods,
  openedYear = null,
}: {
  slug: string;
  periods: PeriodRow[];
  // 受付を始めたばかりの年度。1 秒だけ強調する（§4.5「内容が変わった」）
  openedYear?: number | null;
}) {
  const router = useRouter();
  const base = `/api/${slug}/admin/memberships`;
  const [draft, setDraft] = useState<PeriodDraft>({ year: "", opensDate: "", closesDate: "", autoApprove: false });
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PeriodField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const opened = openedYear ? periods.find((row) => row.year === openedYear) : undefined;

  async function save(year: number): Promise<void> {
    if (pending) return;
    setErrors({});
    setNotice(null);
    setDone(null);
    const parsed = parsePeriodInput({ ...draft, year: String(year) });
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    setPending(`edit:${year}`);
    try {
      const response = await fetch(`${base}/${year}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const parsedBody = (await response.json().catch(() => null)) as PeriodApiBody | null;
      if (response.ok) {
        setDone(`${year}年度の受付を保存しました`);
        setEditingYear(null);
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

  function startEdit(row: PeriodRow): void {
    setErrors({});
    setNotice(null);
    setDone(null);
    setEditingYear(row.year);
    setDraft({ year: String(row.year), opensDate: row.opensDate, closesDate: row.closesDate, autoApprove: row.autoApprove });
  }

  return (
    <div className="flex flex-col gap-4">
      {opened ? <Message kind="success" title={`${opened.yearText}の受付を始めました`} /> : null}
      {notice ? <Message kind="error" title={notice} /> : null}
      {done ? <Message kind="success" title={done} /> : null}

      {periods.length > 0 ? (
        <Toolbar>
          <span className="text-sm font-semibold">受付を始めた年度 {periods.length} 件</span>
          <Link href={`/${slug}/admin/memberships/new`} className={`${buttonClass("primary", false, "sm")} ml-auto`}>
            受付を始める
          </Link>
        </Toolbar>
      ) : null}

      {periods.length === 0 ? (
        <EmptyState
          title="まだ受付を始めた年度はありません"
          description="受付を始めると、協会員の登録をするチームの代表者に案内が出ます。"
          action={
            <Link href={`/${slug}/admin/memberships/new`} className={buttonClass()}>
              受付を始める
            </Link>
          }
        />
      ) : (
        <ul className="bb-stagger grid gap-3 md:grid-cols-2">
          {periods.map((row) => (
            <li key={row.year}>
              <Card className={`flex h-full flex-col gap-2 ${row.year === openedYear ? "bb-highlight" : ""}`}>
                {editingYear === row.year ? (
                  <>
                    <p className="font-bold">{row.yearText}の受付</p>
                    <PeriodFields draft={draft} setDraft={setDraft} errors={errors} idPrefix={`edit-${row.year}`} showYear={false} />
                    <div className="flex flex-wrap gap-2">
                      <Button pending={pending === `edit:${row.year}`} pendingLabel="保存しています…" onClick={() => void save(row.year)}>
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
                      <Badge tone={STATE_TONE[row.stateText] ?? "neutral"}>{row.stateText}</Badge>
                    </div>
                    <p className="text-sm">{row.periodText}</p>
                    <p className="text-sm text-muted">
                      協会員の登録をするチーム {row.targetTeams} 組のうち、申告が届いているのは {row.declaredTeams} 組
                      {row.autoApprove ? "・承認を省く設定です" : ""}
                    </p>
                    <div className="mt-auto pt-2">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(row)}>
                        受付の期間を直す
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
