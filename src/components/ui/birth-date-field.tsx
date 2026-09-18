"use client";

import { useEffect, useRef, useState } from "react";
import { formatPlainDate, type PlainDate, parsePlainDate, todayInTokyo } from "@/lib/date";
import {
  type BirthDateParts,
  DEFAULT_ERA,
  describeBirthDate,
  ERA_CHOICES,
  parseBirthDateParts,
  partsFromDate,
} from "@/lib/wareki";
import { Button } from "./button";

// 親に知らせる値。date = 正しく入力できたときの "YYYY-MM-DD"（途中・誤りなら null）
// ready = date があり、年齢の確認が要らないか「はい、合っています」を押した（これが true になるまで次へ進ませない）
export type BirthDateValue = { date: string | null; ready: boolean };

// 生年月日の入力（設計書 §4.3「生年月日の入力」）。昭和・平成・令和・西暦を大きなボタンで選び（既定は昭和）、
// 年・月・日を数字で入れる（「元年」は 1）。入れるそばに「（1965年）・61歳」を出し、元号の範囲外はその場で誤りにする。
// 今日時点で 15 歳未満か 80 歳以上なら「◯歳で合っていますか？」と確かめる。OS の日付ピッカーは使わない
export function BirthDateField({
  id,
  label = "生年月日",
  initialDate,
  onChange,
  error,
  today,
}: {
  id: string;
  label?: string;
  // 保存済みの値（"YYYY-MM-DD"）。あればその元号で埋める
  initialDate?: string | null;
  onChange?: (value: BirthDateValue) => void;
  // サーバーから返った誤り（その場の検査の誤りより後に出す）
  error?: string | null;
  // テスト用。省略すると日本時間の今日
  today?: PlainDate;
}) {
  const [parts, setParts] = useState<BirthDateParts>(() => {
    const initial = initialDate ? parsePlainDate(initialDate) : null;
    return initial ? partsFromDate(initial) : { era: DEFAULT_ERA, year: "", month: "", day: "" };
  });
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);

  const result = parseBirthDateParts(parts, today ?? todayInTokyo());
  const date = result.status === "ok" ? formatPlainDate(result.date) : null;
  const needsConfirmation = result.status === "ok" && result.needsConfirmation && confirmedDate !== date;
  const ready = date !== null && !needsConfirmation;

  // 親への通知（値が変わったときだけ）
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    onChangeRef.current?.({ date, ready });
  }, [date, ready]);

  const fieldError = result.status === "error" ? result : null;
  const message = fieldError?.message ?? error ?? null;
  const messageId = `${id}-error`;
  const describeId = `${id}-describe`;

  function set<K extends keyof BirthDateParts>(key: K, value: BirthDateParts[K]) {
    setParts((p) => ({ ...p, [key]: value }));
  }

  function numberInput(field: "year" | "month" | "day", suffix: string, width: string, maxLength: number) {
    const invalid = fieldError?.field === field || (!fieldError && !!error);
    return (
      <div className="flex items-center gap-1">
        <input
          id={`${id}-${field}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={maxLength}
          value={parts[field]}
          onChange={(e) => set(field, e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={[message ? messageId : null, date ? describeId : null].filter(Boolean).join(" ") || undefined}
          className={`min-h-12 ${width} rounded-md border bg-background px-3 text-center text-lg ${
            invalid ? "bb-shake border-2 border-danger" : "border-border"
          }`}
        />
        <label htmlFor={`${id}-${field}`} className="font-semibold">
          {suffix}
        </label>
      </div>
    );
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1.5 font-semibold">{label}</legend>

      <div role="radiogroup" aria-label={`${label}の元号`} className="grid grid-cols-4 gap-2">
        {ERA_CHOICES.map((choice) => (
          <label
            key={choice.id}
            className="bb-pressable flex min-h-12 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-base font-semibold has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-focus)]"
          >
            <input
              type="radio"
              name={`${id}-era`}
              value={choice.id}
              checked={parts.era === choice.id}
              onChange={() => set("era", choice.id)}
              className="sr-only"
            />
            {choice.label}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {numberInput("year", "年", "w-20", 4)}
        {numberInput("month", "月", "w-16", 2)}
        {numberInput("day", "日", "w-16", 2)}
      </div>

      {parts.era !== "seireki" ? <p className="text-sm text-muted">元年は 1 と入力してください</p> : null}

      {result.status === "ok" ? (
        <p id={describeId} className="font-semibold" aria-live="polite">
          {describeBirthDate(result.date, result.age, parts.era)}
        </p>
      ) : null}

      {message ? (
        <p id={messageId} role="alert" className="text-sm font-semibold text-danger">
          {message}
        </p>
      ) : null}

      {needsConfirmation && result.status === "ok" ? (
        <div className="flex flex-col gap-3 rounded-md border-2 border-warning bg-background px-4 py-3" role="alert">
          <p className="font-semibold">{result.age}歳で合っていますか？</p>
          <Button variant="secondary" onClick={() => setConfirmedDate(date)}>
            はい、合っています
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
