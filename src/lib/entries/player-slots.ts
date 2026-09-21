import type { MemberSex } from "@/db/schema";
import { type PlainDate, parsePlainDate } from "@/lib/date";
import type { EligibilityPlayer } from "@/lib/eligibility";
import { isUuid } from "@/lib/ids";
import { parsePlayerInput, type PlayerField } from "@/lib/teams/player-input";

// 申込の選手枠（設計書 §5.5「入力ページ」3）。画面（その場の検査）とサーバー（送信・B-10）の両方で使う
// サーバー専用の import を置かない
//
// 枠の決め方は 2 つだけ（v0.9.2）:
//   pick   … 申し込むチームの選手一覧、または代表者を務めるほかのチームの選手（サジェスト・§8.4）から選ぶ
//   manual … 一覧にいない人を手入力する（ご本人の同意を得て入力してもらう・§5.18）
// どちらも氏名・生年月日・性別がそろう。名寄せと選手一覧への自動追加は送信時（B-10・§8.3）

export type PlayerSlotKind = "pick" | "manual";

export type PlayerSlot = {
  kind: PlayerSlotKind;
  // pick のとき。members.id
  memberId: string | null;
  // どちらの枠でも、確認ページと保存に使う値（pick は候補から埋める）
  name: string;
  kana: string | null;
  birthDate: string | null; // YYYY-MM-DD
  sex: MemberSex | "";
  // 「この方ですか？」で「いいえ、別の方です」と答えた枠（新規作成して needs_review・§8.3 の 1a）
  declinedSameName?: boolean;
};

export const emptySlot = (): PlayerSlot => ({ kind: "pick", memberId: null, name: "", kana: null, birthDate: null, sex: "" });

// 大会の下限人数を最初から表示し、上限まで増やせる（§5.5）
export function initialSlots(teamSizeMin: number): PlayerSlot[] {
  return Array.from({ length: Math.max(teamSizeMin, 1) }, emptySlot);
}

export function isBlankSlot(slot: PlayerSlot): boolean {
  return !slot.memberId && !slot.name.trim() && !slot.birthDate && !slot.sex;
}

// 申込の選手枠は審判の資格（K-01）を入力しないので、実際に入るのは氏名・ふりがな・生年月日・性別と memberId だけ
export type PlayerSlotIssue = { index: number; field: PlayerField | "memberId"; message: string };

export type PlayerSlotsResult =
  | { ok: true; players: (PlayerSlot & { birthDate: string; sex: MemberSex })[] }
  | { ok: false; issues: PlayerSlotIssue[] };

// 枠を検査して、埋まっている枠だけを順番に返す。空の枠は飛ばす（下限・上限の人数は呼ぶ側が見る）
export function parsePlayerSlots(slots: PlayerSlot[], today: PlainDate): PlayerSlotsResult {
  const issues: PlayerSlotIssue[] = [];
  const players: (PlayerSlot & { birthDate: string; sex: MemberSex })[] = [];
  const seen = new Map<string, number>();

  slots.forEach((slot, index) => {
    if (isBlankSlot(slot)) return;

    if (slot.kind === "pick") {
      if (!slot.memberId || !isUuid(slot.memberId)) {
        issues.push({ index, field: "memberId", message: "選手を選ぶか、一覧にいない人を入力してください" });
        return;
      }
      // 同じ人を 2 つの枠に入れない（二重選択の防止・§5.5）
      const first = seen.get(slot.memberId);
      if (first !== undefined) {
        issues.push({ index, field: "memberId", message: `${slot.name}さんは${first + 1}人目にも選ばれています` });
        return;
      }
      seen.set(slot.memberId, index);
    }

    // 手入力も、候補から選んだ選手も、氏名・生年月日・性別がそろっていること（§5.5）
    const parsed = parsePlayerInput({ name: slot.name, kana: slot.kana, birthDate: slot.birthDate, sex: slot.sex }, today);
    if (!parsed.ok) {
      issues.push({ index, field: parsed.field, message: parsed.message });
      return;
    }
    // 審判の資格（K-01）は申込には持ち込まない。枠に要る項目だけを取る
    players.push({ ...slot, name: parsed.value.name, kana: parsed.value.kana, birthDate: parsed.value.birthDate, sex: parsed.value.sex });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, players };
}

// 資格バリデーション（eligibility.ts）に渡す形。生年月日は PlainDate に直す
export function toEligibilityPlayers(players: { name: string; birthDate: string; sex: MemberSex }[]): EligibilityPlayer[] {
  return players.map((p) => ({ name: p.name, birthDate: parsePlainDate(p.birthDate) ?? { year: 1900, month: 1, day: 1 }, sex: p.sex }));
}

// 混合の部の画面表示（「男性 3 人・女性 2 人」）。人数の数え方はここ 1 か所
export function countBySex(players: { sex: MemberSex }[]): { male: number; female: number } {
  return {
    male: players.filter((p) => p.sex === "male").length,
    female: players.filter((p) => p.sex === "female").length,
  };
}
