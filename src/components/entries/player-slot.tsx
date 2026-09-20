"use client";

import { useId, useRef, useState } from "react";
import { type BirthDateValue, BirthDateField } from "@/components/ui/birth-date-field";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { ageAt } from "@/lib/age";
import { type PlainDate, parsePlainDate } from "@/lib/date";
import type { EntryFormPlayer } from "@/lib/entries/entry-form";
import type { PlayerSlot } from "@/lib/entries/player-slots";
import { PLAYER_KANA_MAX, PLAYER_NAME_MAX, SEX_CHOICES, SEX_LABEL } from "@/lib/teams/player-input";
import { type SameNameCandidate, useMemberSuggest } from "@/hooks/use-member-suggest";

// 申込の選手枠 1 つ分（設計書 §5.5「入力ページ」3）
// 選ぶ … 申し込むチームの選手一覧（プルダウン）と、名前で探したときのほかのチームの選手（サジェスト・§8.4）
// 手入力 … 一覧にいない人。氏名・ふりがな・生年月日・性別を入れる（ご本人の同意を得て入力してもらう・§5.18）

const MANUAL = "__manual__"; // プルダウンの末尾の「＋ 一覧にいない人を入力する」

export type PlayerSlotErrors = { name?: string; kana?: string; birthDate?: string; sex?: string; memberId?: string };

function personText(birthDate: string | null, sex: string, referenceDate: PlainDate): string {
  const birth = birthDate ? parsePlainDate(birthDate) : null;
  const age = birth ? `${ageAt(birth, referenceDate)}歳` : "";
  const sexLabel = sex === "male" || sex === "female" ? SEX_LABEL[sex] : "";
  return [age, sexLabel].filter(Boolean).join("・");
}

export function PlayerSlotField({
  index,
  slot,
  onChange,
  onRemove,
  roster,
  takenMemberIds,
  slug,
  year,
  membersOnly,
  referenceDate,
  errors,
  notice = null,
}: {
  index: number;
  slot: PlayerSlot;
  onChange: (next: PlayerSlot) => void;
  onRemove: (() => void) | null; // 下限を超えた枠だけ外せる
  roster: EntryFormPlayer[]; // 申し込むチームの選手一覧
  takenMemberIds: Set<string>; // ほかの枠で選ばれている人（二重選択を防ぐ・§5.5）
  slug: string;
  year: number;
  membersOnly: boolean;
  referenceDate: PlainDate;
  errors: PlayerSlotErrors;
  // 枠に添える知らせ（申込の変更で、選手一覧からいなくなった人の印・§5.5）
  notice?: string | null;
}) {
  const uid = useId();
  const id = (part: string) => `slot-${index}-${part}`;
  const [query, setQuery] = useState("");
  const { suggestions, searching, findSameName } = useMemberSuggest({ slug, year, membersOnly, query });
  const [candidates, setCandidates] = useState<SameNameCandidate[] | null>(null);
  const [alreadyOnRoster, setAlreadyOnRoster] = useState<string | null>(null);
  const askedFor = useRef<string>("");

  // 申し込むチームの選手一覧（協会員だけの絞り込み・ほかの枠で選ばれた人を除く・名前での絞り込み）
  const choices = roster.filter((p) => {
    if (takenMemberIds.has(p.memberId) && p.memberId !== slot.memberId) return false;
    if (membersOnly && !p.isMember) return false;
    if (!query.trim()) return true;
    return p.name.includes(query.trim()) || (p.kana ?? "").includes(query.trim());
  });

  // 名前で探したときに出る、代表者を務めるほかのチームの選手（§8.4）
  const others = suggestions.filter(
    (s) => !roster.some((p) => p.memberId === s.member_id) && !takenMemberIds.has(s.member_id),
  );

  function pick(memberId: string) {
    const fromRoster = roster.find((p) => p.memberId === memberId);
    const fromSuggest = others.find((s) => s.member_id === memberId);
    const found = fromRoster
      ? { name: fromRoster.name, kana: fromRoster.kana, birthDate: fromRoster.birthDate, sex: fromRoster.sex }
      : fromSuggest
        ? { name: fromSuggest.name, kana: fromSuggest.kana, birthDate: fromSuggest.birth_date, sex: fromSuggest.sex }
        : null;
    if (!found) return;
    setCandidates(null);
    setAlreadyOnRoster(null);
    onChange({ kind: "pick", memberId, ...found });
  }

  function toManual() {
    setCandidates(null);
    setAlreadyOnRoster(null);
    onChange({ kind: "manual", memberId: null, name: query.trim(), kana: null, birthDate: null, sex: "" });
  }

  function clear() {
    setQuery("");
    setCandidates(null);
    setAlreadyOnRoster(null);
    onChange({ kind: "pick", memberId: null, name: "", kana: null, birthDate: null, sex: "" });
  }

  function setManual<K extends keyof PlayerSlot>(key: K, value: PlayerSlot[K]) {
    onChange({ ...slot, [key]: value });
  }

  // 手入力の氏名を入れて欄を離れたとき、「この方ですか？」を出す（§5.5・§8.3）
  async function askSameName() {
    const name = slot.name.trim();
    if (slot.kind !== "manual" || !name || askedFor.current === name) return;
    askedFor.current = name;
    const found = await findSameName(name);
    const onRoster = found.find((c) => roster.some((p) => p.memberId === c.member_id));
    if (onRoster) {
      // すでに選手一覧にいる人は、プルダウンでの選択に切り替える（§5.5）
      setAlreadyOnRoster(onRoster.name);
      setCandidates(null);
      return;
    }
    setAlreadyOnRoster(null);
    setCandidates(found.filter((c) => !takenMemberIds.has(c.member_id)));
  }

  const chosen = slot.kind === "pick" && slot.memberId;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">{index + 1}人目</h3>
        {onRemove ? (
          <button type="button" onClick={onRemove} className="min-h-11 px-2 text-sm underline underline-offset-2">
            この枠を外す
          </button>
        ) : null}
      </div>

      {chosen ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p>
              <span className="font-semibold">{slot.name}</span>
              <span className="ml-2 text-sm text-muted">{personText(slot.birthDate, slot.sex, referenceDate)}</span>
            </p>
            <Button variant="secondary" onClick={clear}>
              選び直す
            </Button>
          </div>
          {notice ? <p className="text-sm font-semibold text-danger">{notice}</p> : null}
        </div>
      ) : slot.kind === "manual" ? (
        <div className="flex flex-col gap-3">
          <Message kind="info" title="一覧にいない人を入力しています">
            <p>ご本人（未成年の方は保護者）の同意を得て入力してください。</p>
          </Message>
          <TextField
            id={id("name")}
            label="氏名"
            value={slot.name}
            onChange={(e) => setManual("name", e.target.value)}
            onBlur={askSameName}
            error={errors.name}
            maxLength={PLAYER_NAME_MAX * 2}
            autoComplete="off"
            required
          />
          {alreadyOnRoster ? (
            <Message kind="info" title="この方はすでに選手一覧にいます">
              <p>上の「選手を選ぶ」に戻って、{alreadyOnRoster}さんを選んでください。</p>
              <Button variant="secondary" className="mt-2" onClick={clear}>
                選手を選ぶに戻る
              </Button>
            </Message>
          ) : null}
          {candidates && candidates.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
              <p className="font-semibold">この方ですか？</p>
              {candidates.map((c) => (
                <div key={c.member_id} className="flex items-center justify-between gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <p>
                    <span className="font-semibold">{c.name}</span>
                    <span className="ml-2 text-sm text-muted">
                      {c.team_names.join("・")}
                      {c.birth_date ? `・${ageAt(parsePlainDate(c.birth_date) ?? referenceDate, referenceDate)}歳` : ""}
                    </span>
                  </p>
                  <Button variant="secondary" onClick={() => pick(c.member_id)}>
                    はい、この方です
                  </Button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCandidates(null);
                  setManual("declinedSameName", true);
                }}
                className="min-h-11 self-start px-1 underline underline-offset-2"
              >
                いいえ、別の方です
              </button>
            </div>
          ) : null}
          <TextField
            id={id("kana")}
            label="ふりがな（任意）"
            value={slot.kana ?? ""}
            onChange={(e) => setManual("kana", e.target.value)}
            error={errors.kana}
            maxLength={PLAYER_KANA_MAX * 2}
            hint="ひらがなで入力してください"
            autoComplete="off"
          />
          <BirthDateField
            id={id("birth")}
            initialDate={slot.birthDate}
            onChange={(v: BirthDateValue) => setManual("birthDate", v.ready ? v.date : null)}
            error={errors.birthDate}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="font-semibold">性別</legend>
            <div className="flex gap-2">
              {SEX_CHOICES.map((choice) => (
                <label
                  key={choice.id}
                  className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border px-3 ${
                    slot.sex === choice.id ? "border-primary bg-primary-surface font-semibold" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${uid}-sex`}
                    value={choice.id}
                    checked={slot.sex === choice.id}
                    onChange={() => setManual("sex", choice.id)}
                  />
                  {choice.label}
                </label>
              ))}
            </div>
            {errors.sex ? <p className="text-sm font-semibold text-danger">{errors.sex}</p> : null}
          </fieldset>
          <button type="button" onClick={clear} className="min-h-11 self-start px-1 underline underline-offset-2">
            選手を選ぶに戻る
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <TextField
            id={id("search")}
            label="名前で探す（任意）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            hint="2 文字以上入れると、代表を務めるほかのチームの選手も候補に出ます。"
            autoComplete="off"
          />
          <label htmlFor={id("select")} className="font-semibold">
            選手
          </label>
          <select
            id={id("select")}
            value=""
            onChange={(e) => (e.target.value === MANUAL ? toManual() : pick(e.target.value))}
            className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
          >
            <option value="">選んでください</option>
            {choices.map((p) => (
              <option key={p.memberId} value={p.memberId}>
                {p.name}（{personText(p.birthDate, p.sex, referenceDate)}）
              </option>
            ))}
            {others.length > 0 ? (
              <optgroup label="代表を務めるほかのチーム">
                {others.map((s) => (
                  <option key={s.member_id} value={s.member_id}>
                    {s.name}（{s.team_names.join("・")}）
                  </option>
                ))}
              </optgroup>
            ) : null}
            <option value={MANUAL}>＋ 一覧にいない人を入力する</option>
          </select>
          {searching ? <p className="text-sm text-muted">探しています…</p> : null}
          {errors.memberId ? <p className="text-sm font-semibold text-danger">{errors.memberId}</p> : null}
        </div>
      )}
    </li>
  );
}
