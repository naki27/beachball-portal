"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useHydrated } from "@/hooks/use-hydrated";
import { todayInTokyo } from "@/lib/date";
import type { EntryFormPlayer } from "@/lib/entries/entry-form";
import { ENTRY_NOTE_MAX, type EntryEditField, parseEntryEditInput } from "@/lib/entries/entry-input";
import { countBySex, emptySlot, isBlankSlot, parsePlayerSlots, type PlayerSlot } from "@/lib/entries/player-slots";
import { toEligibilityPlayers } from "@/lib/entries/player-slots";
import { type EligibilityResult, hasEligibilityError, validateEligibility } from "@/lib/eligibility";
import { TEAM_NAME_MAX } from "@/lib/teams/team-input";
import type { EntryFormCategoryView } from "./entry-form";
import { PlayerSlotField, type PlayerSlotErrors } from "./player-slot";

// 申込の変更（設計書 §5.5(d)）。入力ページと同じ部品に、いまの申込の内容を入れて出す
// 確認ページは挟まない（すでに申し込み済みで、締切まで何度でも直せるため）。送信は PATCH /api/[slug]/entries/[id]

export function EntryEditForm({
  slug,
  entryId,
  categories,
  roster,
  initialSlots,
  initialCategoryId,
  initialTeamName,
  initialNote,
  missingMemberIds,
  teamSizeMin,
  teamSizeMax,
  year,
  showMembersOnly,
}: {
  slug: string;
  entryId: string;
  categories: EntryFormCategoryView[];
  roster: EntryFormPlayer[];
  initialSlots: PlayerSlot[];
  initialCategoryId: string;
  initialTeamName: string;
  initialNote: string;
  // 申込のあとで選手一覧からいなくなった人（脱退・削除）。枠に印を出す（§5.5「申込はスナップショット」）
  missingMemberIds: string[];
  teamSizeMin: number;
  teamSizeMax: number;
  year: number;
  showMembersOnly: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [teamName, setTeamName] = useState(initialTeamName);
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [note, setNote] = useState(initialNote);
  const [slots, setSlots] = useState<PlayerSlot[]>(initialSlots);
  const [errors, setErrors] = useState<Partial<Record<EntryEditField, string>>>({});
  const [slotErrors, setSlotErrors] = useState<Record<number, PlayerSlotErrors>>({});
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [membersOnly, setMembersOnly] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const missing = useMemo(() => new Set(missingMemberIds), [missingMemberIds]);
  const taken = useMemo(() => new Set(slots.map((slot) => slot.memberId).filter((id): id is string => !!id)), [slots]);
  const chosen = categories.find((c) => c.id === categoryId);
  const filled = slots.filter((slot) => !isBlankSlot(slot));
  const counts = countBySex(filled.filter((slot): slot is PlayerSlot & { sex: "male" | "female" } => slot.sex !== ""));

  function setSlot(index: number, next: PlayerSlot) {
    setSlots((current) => current.map((slot, i) => (i === index ? next : slot)));
  }

  async function save() {
    if (pending) return;
    setFailure(null);
    setEligibility(null);

    const parsed = parseEntryEditInput({ teamName, categoryId, note });
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    setErrors({});

    const parsedSlots = parsePlayerSlots(slots, todayInTokyo());
    if (!parsedSlots.ok) {
      const found: Record<number, PlayerSlotErrors> = {};
      for (const issue of parsedSlots.issues) found[issue.index] = { ...found[issue.index], [issue.field]: issue.message };
      setSlotErrors(found);
      return;
    }
    setSlotErrors({});
    if (parsedSlots.players.length < teamSizeMin) {
      setSlotErrors({ 0: { memberId: `この大会は${teamSizeMin}人以上で申し込みます（いま${parsedSlots.players.length}人）` } });
      return;
    }

    if (chosen) {
      const result = validateEligibility(toEligibilityPlayers(parsedSlots.players), chosen.preset, chosen.referenceDate);
      setEligibility(result);
      if (hasEligibilityError(result)) return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/${slug}/entries/${entryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ teamName, categoryId, note, slots }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) {
        setFailure(body?.error?.message ?? "変更できませんでした");
        return;
      }
      router.push(`/${slug}/entries/${entryId}`);
      router.refresh();
    } catch {
      setFailure("変更できませんでした。電波の状態を確かめてください");
    } finally {
      setPending(false);
    }
  }

  return (
    <div data-hydrated={hydrated || undefined} className="flex flex-col gap-6">
      <TextField
        id="entry-edit-team-name"
        label="チーム名（公開されます）"
        value={teamName}
        onChange={(e) => setTeamName(e.target.value)}
        error={errors.teamName}
        maxLength={TEAM_NAME_MAX * 2}
        required
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="entry-edit-category" className="font-semibold">
          出場する部
        </label>
        <select
          id="entry-edit-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-describedby="entry-edit-condition"
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
        >
          <option value="">選んでください</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id} disabled={!category.selectable}>
              {category.label}
              {category.note ? `（${category.note}）` : ""}
            </option>
          ))}
        </select>
        <p id="entry-edit-condition" className="text-sm text-muted">
          {chosen ? `${chosen.condition}${chosen.deadline}` : "部を選ぶと、出場できる条件がここに出ます。"}
        </p>
        {errors.categoryId ? <p className="text-sm font-semibold text-danger">{errors.categoryId}</p> : null}
      </div>

      <section aria-labelledby="entry-edit-players" className="flex flex-col gap-3">
        <h2 id="entry-edit-players" className="text-lg font-bold">
          出場する選手
        </h2>
        <p className="text-sm text-muted">
          {teamSizeMin}人以上{teamSizeMax}人まで。選手一覧から選ぶか、一覧にいない人は入力してください。
        </p>
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
        <ul className="flex flex-col gap-3">
          {slots.map((slot, index) => (
            <PlayerSlotField
              key={index}
              index={index}
              slot={slot}
              onChange={(next) => setSlot(index, next)}
              onRemove={slots.length > teamSizeMin ? () => setSlots((current) => current.filter((_, i) => i !== index)) : null}
              roster={roster}
              takenMemberIds={taken}
              slug={slug}
              year={year}
              membersOnly={membersOnly}
              referenceDate={chosen?.referenceDate ?? todayInTokyo()}
              errors={slotErrors[index] ?? {}}
              // 申込のあとで脱退・削除された人は印を出し、外すか残すかを代表者が決める（§5.5）
              notice={slot.memberId && missing.has(slot.memberId) ? "この方は選手一覧にいません" : null}
            />
          ))}
        </ul>
        {slots.length < teamSizeMax ? (
          <Button variant="secondary" onClick={() => setSlots((current) => [...current, emptySlot()])} className="self-start">
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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="entry-edit-note" className="font-semibold">
          備考（任意）
        </label>
        <textarea
          id="entry-edit-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={ENTRY_NOTE_MAX}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
        />
        {errors.note ? <p className="text-sm font-semibold text-danger">{errors.note}</p> : null}
      </div>

      {failure ? <Message kind="error" title="変更できませんでした">{<p>{failure}</p>}</Message> : null}
      <Button fullWidth onClick={save} pending={pending} pendingLabel="変更しています…">
        この内容に変更する
      </Button>
    </div>
  );
}
