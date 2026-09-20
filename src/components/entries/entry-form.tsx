"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { useDraft } from "@/hooks/use-draft";
import { useHydrated } from "@/hooks/use-hydrated";
import { draftKey } from "@/lib/draft";
import { ENTRY_NOTE_MAX, type EntryField, parseEntryInput } from "@/lib/entries/entry-input";
import { TEAM_NAME_MAX } from "@/lib/teams/team-input";

// 大会申込の入力ページ（設計書 §5.5「入力ページ」1・2・4・5）。選手枠は B-09、送信は B-10
// 入力は一時保存する（§4.3）。セッションが切れて 403 になっても、ログインして戻れば保存した内容が戻る

export type EntryFormTeamView = { id: string; name: string };
export type EntryFormCategoryView = { id: string; label: string; condition: string; deadline: string; selectable: boolean; note: string | null };

export type EntryFormValues = {
  teamId: string;
  newTeamName: string;
  teamName: string;
  categoryId: string;
  note: string;
  token: string;
};

export function EntryForm({
  associationId,
  tournamentId,
  teams,
  categories,
  token,
}: {
  associationId: string;
  tournamentId: string;
  teams: EntryFormTeamView[];
  categories: EntryFormCategoryView[];
  token: string;
}) {
  const hydrated = useHydrated();
  const key = draftKey({ associationId, screen: "entry-form", targetId: tournamentId });
  const selectable = categories.filter((c) => c.selectable);

  const [values, setValues] = useState<EntryFormValues>({
    teamId: teams[0]?.id ?? "",
    newTeamName: "",
    teamName: teams[0]?.name ?? "",
    categoryId: selectable.length === 1 ? selectable[0].id : "",
    note: "",
    // 画面を開くたびに発行される値。下書きに入っていればそちらを使う（同じ申し込みの間は変えない）
    token,
  });
  const [errors, setErrors] = useState<Partial<Record<EntryField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);

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

  // 「確認へ」は入力を検査するところまで。確認ページは選手枠（B-09）と送信（B-10）がそろってから
  function onNext() {
    setNotice(null);
    const parsed = parseEntryInput(values);
    if (!parsed.ok) {
      setErrors({ [parsed.field]: parsed.message });
      return;
    }
    setErrors({});
    setNotice("ここまでの入力は保存しました。選手を選ぶところができたら、確認へ進めるようになります。");
  }

  const chosen = categories.find((c) => c.id === values.categoryId);

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
              className="min-h-12 w-full rounded-md border border-border bg-background px-3 text-base"
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
          <p id="entry-category-condition" className="text-sm text-muted">
            {chosen ? `${chosen.condition}${chosen.deadline}` : "部を選ぶと、出場できる条件がここに出ます。"}
          </p>
          {errors.categoryId ? <p className="text-sm font-semibold text-danger">{errors.categoryId}</p> : null}
        </div>
      </section>

      <section aria-labelledby="entry-players" className="flex flex-col gap-3">
        <h2 id="entry-players" className="text-lg font-bold">
          出場する選手
        </h2>
        <Message kind="info" title="選手を選ぶところは準備中です">
          <p>いまはチームと部だけを決められます。入れた内容はこの端末に残るので、続きからお使いいただけます。</p>
        </Message>
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
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
        />
        <p id="entry-note-hint" className="text-sm text-muted">
          駐車場の利用など、伝えることがあれば書いてください。
        </p>
        {errors.note ? <p className="text-sm font-semibold text-danger">{errors.note}</p> : null}
      </section>

      {notice ? <Message kind="success" title={notice} /> : null}
      {draft.savedAt ? <p className="text-sm text-muted">入力した内容をこの端末に保存しました。</p> : null}
      <Button fullWidth onClick={onNext}>
        確認へ
      </Button>
    </div>
  );
}
