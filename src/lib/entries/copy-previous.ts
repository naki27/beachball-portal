import type { MemberSex } from "@/db/schema";
import { emptySlot, type PlayerSlot } from "./player-slots";

// 前回コピー（設計書 §5.5(b)）。画面（ボタン）とテストの両方で使う純粋な処理
// サーバー専用の import を置かない
//
//   選手 … 前回の申込の選手のうち、**いま申し込むチームの選手一覧にいる人**だけを枠に戻す。
//          脱退・削除された人は戻さず、「◯◯さんは選手一覧にいないため外しました」と伝える
//   部   … 同じ `code` の部が今回の大会にあれば自動選択（表示名が「混合」→「MIX」に変わっていても対応づく）

// 前回の申込の選手（人物を物理削除された行は member_id が NULL・§5.16）
export type PreviousPlayer = { memberId: string | null; name: string };

// 枠に戻せる人（申し込むチームの選手一覧）。生年月日まで持つのは代表者の画面だから（§3.2）
export type RosterPlayer = { memberId: string; name: string; kana: string | null; birthDate: string; sex: MemberSex };

export type CopiedSlots = {
  slots: PlayerSlot[];
  // 復元できなかった人の氏名（画面に理由を出す）
  dropped: string[];
};

// 前回の選手を枠に戻す。枠の数は大会の下限以上・上限以下に収める
export function buildCopiedSlots(
  previous: PreviousPlayer[],
  roster: RosterPlayer[],
  teamSizeMin: number,
  teamSizeMax: number,
): CopiedSlots {
  const byId = new Map(roster.map((player) => [player.memberId, player]));
  const slots: PlayerSlot[] = [];
  const dropped: string[] = [];

  for (const player of previous) {
    const found = player.memberId ? byId.get(player.memberId) : undefined;
    if (!found) {
      dropped.push(player.name);
      continue;
    }
    if (slots.length >= teamSizeMax) {
      dropped.push(player.name);
      continue;
    }
    slots.push({ kind: "pick", memberId: found.memberId, name: found.name, kana: found.kana, birthDate: found.birthDate, sex: found.sex });
  }

  // 下限の人数までは空の枠を出す（転記後は自由に編集できる・§5.5(b)）
  while (slots.length < Math.max(teamSizeMin, 1)) slots.push(emptySlot());
  return { slots, dropped };
}

// 同じ `code` の部を選ぶ。なければ空のまま（選べない部も選ばない）
export function pickCategoryByCode<T extends { id: string; code: string; selectable: boolean }>(
  categories: T[],
  code: string,
): string {
  return categories.find((category) => category.code === code && category.selectable)?.id ?? "";
}

// 外した人の知らせ（§5.5(b) の文言）
export function droppedMessage(dropped: string[]): string | null {
  if (dropped.length === 0) return null;
  return `${dropped.join("さん、")}さんは選手一覧にいないため外しました`;
}
