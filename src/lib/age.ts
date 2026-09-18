// src/lib/age.ts — 年齢の唯一の実装（設計書 付録 D）。年月日（PlainDate）どうしで数え、Date・TZ に頼らない
// 誕生日の当日に 1 つ増える。2 月 29 日生まれは、平年は 2 月 28 日ではまだ増えず 3 月 1 日に増える
// 基準日（大会の年齢の基準日など）の決め方は deadline.ts（B-02）

import type { PlainDate } from "./date";

// on の日の満年齢。on が生まれる前なら負の数になる（呼ぶ側で未来の生年月日を弾く）
export function ageAt(birth: PlainDate, on: PlainDate): number {
  const years = on.year - birth.year;
  const beforeBirthday = on.month < birth.month || (on.month === birth.month && on.day < birth.day);
  return beforeBirthday ? years - 1 : years;
}
