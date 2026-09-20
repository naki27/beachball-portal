// src/lib/deadline.ts — 有効な締切・有効な年齢の基準日・受付の可否の唯一の実装（設計書 §5.4・付録 D）
// 締切と基準日は「部門 → 大会」の順でフォールバックする（部門の値が NULL なら大会の値）
// 受付できるかは大会の状態と期間の両方で決める。画面・API・ジョブのすべてでここを通す（ほかの場所で now と締切を比べない）

import type { TournamentStatus } from "@/db/schema";
import { diffDays, type PlainDate, todayInTokyo } from "./date";

// 判定に必要な分だけを受け取る（行そのものを渡しても通る）
export type TournamentDeadline = { status: TournamentStatus; entryStartAt: Date | null; entryEndAt: Date };
export type CategoryDeadline = { entryEndAt: Date | null };

// 受付できない理由まで返す（画面の文言と 409 の出し分けに使う・§4.4）
export type EntryState = "open" | "not_started" | "closed" | "unavailable";

// 有効な締切 = 部門の締切 ?? 大会の締切（大会の締切は必須・§5.4）
export function effectiveDeadline(category: CategoryDeadline, tournament: { entryEndAt: Date }): Date {
  return category.entryEndAt ?? tournament.entryEndAt;
}

// 有効な年齢の基準日 = 部門の基準日 ?? 大会の基準日（大会の基準日は必須・§14-21）
export function effectiveAgeReferenceDate(
  category: { ageReferenceDate: PlainDate | null },
  tournament: { ageReferenceDate: PlainDate },
): PlainDate {
  return category.ageReferenceDate ?? tournament.ageReferenceDate;
}

// 部門ごとに判定する（ある部門が締め切られても、締切が後の部門はまだ申込できる・追加仕様 2）
export function entryState(tournament: TournamentDeadline, category: CategoryDeadline, now: Date): EntryState {
  // 準備中・開催後は、そもそも受付の期間を見ない
  if (tournament.status === "draft" || tournament.status === "archived") return "unavailable";
  // 手で締め切ったときは期間内でも締切後の扱い
  if (tournament.status === "closed") return "closed";
  if (tournament.entryStartAt && now < tournament.entryStartAt) return "not_started";
  if (now > effectiveDeadline(category, tournament)) return "closed";
  return "open";
}

export function isEntryOpen(tournament: TournamentDeadline, category: CategoryDeadline, now: Date): boolean {
  return entryState(tournament, category, now) === "open";
}

// 大会そのものの受付の状態（部ごとの締切が違う大会もあるので、部をまとめて見る・追加仕様 2）
// 1 つでも受け付けている部があれば「受付中」。まだどの部も始まっていなければ「これから」
export function tournamentEntryState(tournament: TournamentDeadline, categories: readonly CategoryDeadline[], now: Date): EntryState {
  if (categories.length === 0) return entryState(tournament, { entryEndAt: null }, now);
  const states = categories.map((category) => entryState(tournament, category, now));
  if (states.includes("open")) return "open";
  if (states.every((state) => state === "not_started")) return "not_started";
  if (states.every((state) => state === "unavailable")) return "unavailable";
  return "closed";
}

// 締切まであと何日か（日本時間の暦の上の差）。当日は 0、過ぎていれば負（画面の「あと5日」・§5.6）
export function daysUntilDeadline(deadline: Date, now: Date = new Date()): number {
  return diffDays(todayInTokyo(now), todayInTokyo(deadline));
}
