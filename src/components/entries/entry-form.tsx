"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionBar } from "@/components/ui/layout";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useDraft } from "@/hooks/use-draft";
import { useHydrated } from "@/hooks/use-hydrated";
import { todayInTokyo } from "@/lib/date";
import { draftKey } from "@/lib/draft";
import type { EntryFormPlayer } from "@/lib/entries/entry-form";
import { ENTRY_NOTE_MAX, type EntryField, parseEntryInput } from "@/lib/entries/entry-input";
import {
  countBySex,
  emptySlot,
  initialSlots,
  isBlankSlot,
  parsePlayerSlots,
  type PlayerSlot,
  toEligibilityPlayers,
} from "@/lib/entries/player-slots";
import { buildCopiedSlots, droppedMessage, pickCategoryByCode, type PreviousPlayer } from "@/lib/entries/copy-previous";
import { type EntrySubmitError, takeSubmitError } from "@/lib/entries/submit-error";
import { type EligibilityPreset, type EligibilityResult, hasEligibilityError, validateEligibility } from "@/lib/eligibility";
import { TEAM_NAME_MAX } from "@/lib/teams/team-input";
import { PlayerSlotField, type PlayerSlotErrors } from "./player-slot";

// 大会申込の入力ページ（設計書 §5.5「入力ページ」1・2・4・5）。選手枠は B-09、送信は B-10
// 入力は一時保存する（§4.3）。セッションが切れて 403 になっても、ログインして戻れば保存した内容が戻る

export type EntryFormTeamView = { id: string; name: string };
export type EntryFormCategoryView = {
  id: string;
  code: string;
  label: string;
  condition: string;
  deadline: string;
  selectable: boolean;
  note: string | null;
  // 資格バリデーション（§5.5(e)）をその場で回すための設定値と基準日
  preset: EligibilityPreset;
  referenceDate: { year: number; month: number; day: number };
};

export type EntryFormValues = {
  teamId: string;
  newTeamName: string;
  teamName: string;
  categoryId: string;
  slots: PlayerSlot[];
  note: string;
  token: string;
};

export function EntryForm({
  slug,
  associationId,
  tournamentId,
  teams,
  categories,
  rosters,
  teamSizeMin,
  teamSizeMax,
  year,
  showMembersOnly,
  token,
}: {
  slug: string;
  associationId: string;
  tournamentId: string;
  teams: EntryFormTeamView[];
  categories: EntryFormCategoryView[];
  rosters: Record<string, EntryFormPlayer[]>;
  teamSizeMin: number;
  teamSizeMax: number;
  year: number;
  showMembersOnly: boolean;
  token: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const key = draftKey({ associationId, screen: "entry-form", targetId: tournamentId });
  const selectable = categories.filter((c) => c.selectable);

  const [values, setValues] = useState<EntryFormValues>({
    teamId: teams[0]?.id ?? "",
    newTeamName: "",
    teamName: teams[0]?.name ?? "",
    categoryId: selectable.length === 1 ? selectable[0].id : "",
    // 大会の下限人数を最初から表示する（§5.5）
    slots: initialSlots(teamSizeMin),
    note: "",
    // 画面を開くたびに発行される値。下書きに入っていればそちらを使う（同じ申し込みの間は変えない）
    token,
  });
  const [errors, setErrors] = useState<Partial<Record<EntryField, string>>>({});
  const [slotErrors, setSlotErrors] = useState<Record<number, PlayerSlotErrors>>({});
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [membersOnly, setMembersOnly] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 前回コピー（§5.5(b)）の結果。外した選手の理由もここに出す
  const [copied, setCopied] = useState<{ title: string; dropped: string | null } | null>(null);
  const [copying, setCopying] = useState(false);
  // 確認ページで断られた理由（締切・定員・資格）。該当する枠・欄の下にも出す（§5.5）
  // sessionStorage から 1 回だけ読む（URL には載せない・§12）。描画は hydrated のあとなので食い違わない
  const [rejected, setRejected] = useState<EntrySubmitError | null>(() => takeSubmitError(key));

  // 下書きが残っていれば戻す（ログインし直したあともここで戻る）
  const onRestore = useCallback((restored: EntryFormValues) => setValues(restored), []);
  const draft = useDraft<EntryFormValues>(key, { onRestore });

  function set<K extends keyof EntryFormValues>(field: K, value: EntryFormValues[K]) {
    setValues((current) => {
      const next = { ...current, [field]: value };
      // チームを選び直したら、公開されるチーム名もそのチームの名前にする（この申し込みに限って変えられる）
      if (field === "teamId") next.teamName = teams.find((t) => t.id === value)?.name ?? "";
      draft.save(next);
      return next;
    });
  }

  function setSlot(index: number, next: PlayerSlot) {
    setValues((current) => {
      const slots = current.slots.map((slot, i) => (i === index ? next : slot));
      const updated = { ...current, slots };
      draft.save(updated);
      return updated;
    });
  }

  function addSlot() {
    setValues((current) => {
      if (current.slots.length >= teamSizeMax) return current;
      const updated = { ...current, slots: [...current.slots, emptySlot()] };
      draft.save(updated);
      return updated;
    });
  }

  function removeSlot(index: number) {
    setValues((current) => {
      const updated = { ...current, slots: current.slots.filter((_, i) => i !== index) };
      draft.save(updated);
      return updated;
    });
  }

  // 「前回と同じ選手にする」（§5.5(b)）。直近の申込の選手のうち、いまの選手一覧にいる人だけを枠に戻す
  async function copyPrevious() {
    const teamId = values.teamId;
    if (!teamId || copying) return;
    setCopying(true);
    setCopied(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/${slug}/teams/${teamId}/entries/latest`, { headers: { accept: "application/json" } });
      const body = (await response.json()) as {
        entry?: { tournamentName: string; categoryCode: string; cancelled: boolean; players: PreviousPlayer[] } | null;
      };
      if (!response.ok || !body.entry) {
        setCopied({ title: "前回の申し込みが見つかりませんでした", dropped: null });
        return;
      }
      const previous = body.entry;
      const { slots, dropped } = buildCopiedSlots(previous.players, rosters[teamId] ?? [], teamSizeMin, teamSizeMax);
      // 部は同じ code のものを選び直す（表示名が変わっていても対応づく）。今回の大会になければ空にする
      const categoryId = pickCategoryByCode(categories, previous.categoryCode);
      // 一時保存はこの場で書く（描画の途中に書かないよう、状態の更新の外で呼ぶ）
      const updated = { ...values, slots, categoryId };
      setValues(updated);
      draft.saveNow(updated);
      setSlotErrors({});
      setEligibility(null);
      setCopied({
        title: `前回（${previous.tournamentName}${previous.cancelled ? "・取り消した申し込み" : ""}）と同じ選手にしました`,
        dropped: droppedMessage(dropped),
      });
    } catch {
      setCopied({ title: "読み込めませんでした。しばらくしてからもう一度お試しください", dropped: null });
    } finally {
      setCopying(false);
    }
  }

  const chosen = categories.find((c) => c.id === values.categoryId);
  const roster = rosters[values.teamId] ?? [];
  // ほかの枠で選ばれている人は候補に出さない（二重選択を防ぐ・§5.5）
  const taken = useMemo(
    () => new Set(values.slots.map((slot) => slot.memberId).filter((id): id is string => !!id)),
    [values.slots],
  );
  // 断られた理由は、該当する枠（または部の欄）の誤りとしても出す
  const slotErrorsView = rejected && typeof rejected.playerIndex === "number"
    ? { ...slotErrors, [rejected.playerIndex]: { ...slotErrors[rejected.playerIndex], memberId: rejected.message } }
    : slotErrors;
  const errorsView = rejected && rejected.field === "categoryId" ? { ...errors, categoryId: rejected.message } : errors;
  const filled = values.slots.filter((slot) => !isBlankSlot(slot));
  const counts = countBySex(filled.filter((slot): slot is PlayerSlot & { sex: "male" | "female" } => slot.sex !== ""));

  // 「確認へ」を押した時点で部門の資格バリデーション（§5.5(e)）。通れば確認ページへ進む
  function onNext() {
    setNotice(null);
    setRejected(null);
    setEligibility(null);
    const parsed = parseEntryInput(values);
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      setSlotErrors({});
      return;
    }
    setErrors({});

    const slots = parsePlayerSlots(values.slots, todayInTokyo());
    if (!slots.ok) {
      const found: Record<number, PlayerSlotErrors> = {};
      for (const issue of slots.issues) found[issue.index] = { ...found[issue.index], [issue.field]: issue.message };
      setSlotErrors(found);
      return;
    }
    setSlotErrors({});

    // 人数の下限・上限は資格バリデーションとは別に見る（§5.4）
    if (slots.players.length < teamSizeMin) {
      setNotice(null);
      setSlotErrors({ 0: { memberId: `この大会は${teamSizeMin}人以上で申し込みます（いま${slots.players.length}人）` } });
      return;
    }

    const category = categories.find((c) => c.id === parsed.value.categoryId);
    if (category) {
      const result = validateEligibility(toEligibilityPlayers(slots.players), category.preset, category.referenceDate);
      setEligibility(result);
      // エラーがあれば進ませない（警告と「表示のみ」は進める・§5.5(e)）
      if (hasEligibilityError(result)) return;
    }
    // 入力は一時保存にあるので、確認ページはそれを読む（§4.3）。待たずに書く（移動で消えないように）
    draft.saveNow(values);
    router.push(`/${slug}/tournaments/${tournamentId}/entry/confirm`);
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-6">
      <section aria-labelledby="entry-team" className="flex flex-col gap-4">
        <h2 id="entry-team" className="text-lg font-bold">
          申し込むチーム
        </h2>
        {teams.length === 0 ? (
          <>
            <Message kind="info" title="代表を務めるチームがありません">
              <p>この場でチームを作って申し込めます。チーム名を入れてください。</p>
            </Message>
            <TextField
              id="entry-new-team"
              label="チーム名"
              value={values.newTeamName}
              onChange={(e) => {
                set("newTeamName", e.target.value);
                set("teamName", e.target.value);
              }}
              error={errors.newTeamName}
              maxLength={TEAM_NAME_MAX * 2}
              required
            />
          </>
        ) : teams.length === 1 ? (
          <p className="font-semibold">{teams[0].name}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="entry-team-select" className="font-semibold">
              チーム
            </label>
            <select
              id="entry-team-select"
              value={values.teamId}
              onChange={(e) => set("teamId", e.target.value)}
              className="min-h-12 w-full rounded-md border border-border-strong bg-background px-3 text-base"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            {errors.teamId ? <p className="text-sm font-semibold text-danger">{errors.teamId}</p> : null}
          </div>
        )}
        <TextField
          id="entry-team-name"
          label="チーム名（公開されます）"
          value={values.teamName}
          onChange={(e) => set("teamName", e.target.value)}
          error={errors.teamName}
          maxLength={TEAM_NAME_MAX * 2}
          hint="参加チーム一覧に出る名前です。この申し込みだけ変えられます（登録しているチーム名は変わりません）。"
          required
        />
      </section>

      <section aria-labelledby="entry-category" className="flex flex-col gap-4">
        <h2 id="entry-category" className="text-lg font-bold">
          出場する部
        </h2>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="entry-category-select" className="font-semibold">
            部
          </label>
          <select
            id="entry-category-select"
            value={values.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            aria-describedby="entry-category-condition"
            className="min-h-12 w-full rounded-md border border-border-strong bg-background px-3 text-base"
          >
            <option value="">選んでください</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id} disabled={!category.selectable}>
                {category.label}
                {category.note ? `（${category.note}）` : ""}
              </option>
            ))}
          </select>
          <p id="entry-category-condition" className="text-sm text-muted">
            {chosen ? `${chosen.condition}${chosen.deadline}` : "部を選ぶと、出場できる条件がここに出ます。"}
          </p>
          {errorsView.categoryId ? <p className="text-sm font-semibold text-danger">{errorsView.categoryId}</p> : null}
        </div>
      </section>

      <section aria-labelledby="entry-players" className="flex flex-col gap-3">
        <h2 id="entry-players" className="text-lg font-bold">
          出場する選手
        </h2>
        <p className="text-sm text-muted">
          {teamSizeMin}人以上{teamSizeMax}人まで。選手一覧から選ぶか、一覧にいない人は入力してください。
        </p>
        {values.teamId ? (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={copyPrevious} pending={copying} pendingLabel="読み込んでいます…" className="self-start">
              前回と同じ選手にする
            </Button>
            {copied ? (
              <Message kind="info" title={copied.title}>
                {copied.dropped ? <p>{copied.dropped}</p> : null}
              </Message>
            ) : null}
          </div>
        ) : null}
        {showMembersOnly ? (
          <label className="flex min-h-12 items-center gap-2 self-start">
            <input type="checkbox" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
            協会員だけを表示
          </label>
        ) : null}
        {chosen && chosen.preset.gender === "mixed" ? (
          <p className="text-sm font-semibold" data-testid="entry-sex-counts">
            いま 男性{counts.male}人・女性{counts.female}人（コートに出る{chosen.preset.courtSize}人のうち、男性
            {chosen.preset.mixedMinMale}人以上・女性{chosen.preset.mixedMinFemale}人以上）
          </p>
        ) : null}
        <ul className="grid gap-3 lg:grid-cols-2">
          {values.slots.map((slot, index) => (
            <PlayerSlotField
              // 枠は並べ替えない。増減は末尾だけなので添字で足りる
              key={index}
              index={index}
              slot={slot}
              onChange={(next) => setSlot(index, next)}
              onRemove={values.slots.length > teamSizeMin ? () => removeSlot(index) : null}
              roster={roster}
              takenMemberIds={taken}
              slug={slug}
              year={year}
              membersOnly={membersOnly}
              referenceDate={chosen?.referenceDate ?? todayInTokyo()}
              errors={slotErrorsView[index] ?? {}}
            />
          ))}
        </ul>
        {values.slots.length < teamSizeMax ? (
          <Button variant="secondary" onClick={addSlot} className="self-start">
            選手を追加
          </Button>
        ) : null}
        {eligibility && eligibility.issues.length > 0 ? (
          <div className="flex flex-col gap-2">
            {eligibility.issues.map((issue) => (
              <Message key={issue.message} kind={issue.level === "error" ? "error" : "info"} title={issue.message} />
            ))}
          </div>
        ) : null}
        {eligibility && eligibility.infos.length > 0 ? (
          <dl className="flex flex-col gap-1 text-sm">
            {eligibility.infos.map((info) => (
              <div key={info.label} className="flex gap-2">
                <dt className="font-semibold">{info.label}</dt>
                <dd>{info.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <section aria-labelledby="entry-note" className="flex flex-col gap-1.5">
        <h2 id="entry-note" className="text-lg font-bold">
          備考（任意）
        </h2>
        <label htmlFor="entry-note-input" className="font-semibold">
          運営に伝えること
        </label>
        <textarea
          id="entry-note-input"
          value={values.note}
          onChange={(e) => set("note", e.target.value)}
          rows={4}
          maxLength={ENTRY_NOTE_MAX}
          aria-describedby="entry-note-hint"
          className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-base"
        />
        <p id="entry-note-hint" className="text-sm text-muted">
          駐車場の利用など、伝えることがあれば書いてください。
        </p>
        {errors.note ? <p className="text-sm font-semibold text-danger">{errors.note}</p> : null}
      </section>

      {rejected ? (
        <Message kind="error" title="この内容では申し込めませんでした">
          <p>{rejected.message}</p>
        </Message>
      ) : null}
      {notice ? <Message kind="success" title={notice} /> : null}
      {draft.savedAt ? <p className="text-sm text-muted">入力した内容をこの端末に保存しました。</p> : null}
      {/* 主要操作はスマホだけ画面の下に貼り付ける（§4.3・v0.9.6）。PC は本文の中 */}
      <ActionBar>
        <Button fullWidth onClick={onNext}>
          確認へ
        </Button>
      </ActionBar>
    </div>
  );
}
