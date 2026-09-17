## 付録 D. 年齢判定・締切判定のヘルパー（TypeScript）

```ts
// src/lib/date.ts — 業務上の日付は日本時間の「年月日」で扱う（§7.0）
// 生年月日・基準日を JavaScript の Date にすると UTC で 1 日ずれるため、年月日の組で持つ
export type PlainDate = { year: number; month: number; day: number };  // month は 1〜12

export function todayInTokyo(now: Date = new Date()): PlainDate {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now).split("-").map(Number);
  return { year, month, day };
}
// 日付で入力された締切 → その日の 23:59:59.999（日本時間）の瞬間（§5.4）
export function endOfDayTokyo(d: PlainDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, 23 - 9, 59, 59, 999));
}
// 日付で入力された申込開始 → その日の 0:00（日本時間）の瞬間
export function startOfDayTokyo(d: PlainDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, -9, 0, 0, 0));
}

// src/lib/age.ts — 年齢の算出はここだけ。境界のテストを必ず書く
export function ageAt(birth: PlainDate, ref: PlainDate): number {
  let age = ref.year - birth.year;
  if (ref.month < birth.month || (ref.month === birth.month && ref.day < birth.day)) age--;
  return age;
}
// テスト必須ケース: 誕生日前日 / 当日 / 翌日、2/29 生まれは平年の 2/28 でまだ加齢せず 3/1 で加齢（§5.5(e)）

// src/lib/deadline.ts — 有効な締切は「部門 → 大会」の順でフォールバック
export function effectiveDeadline(
  category: { entryEndAt: Date | null },
  tournament: { entryEndAt: Date },            // 大会の締切は必須（§5.4）
): Date {
  return category.entryEndAt ?? tournament.entryEndAt;
}
export function effectiveAgeReferenceDate(
  category: { ageReferenceDate: PlainDate | null },
  tournament: { ageReferenceDate: PlainDate },
): PlainDate {
  return category.ageReferenceDate ?? tournament.ageReferenceDate;
}

// 受付の可否は大会の状態と期間の両方で決める（§5.4 の表）。画面・API・ジョブのすべてでこれを使う
type TournamentStatus = "draft" | "open" | "closed" | "archived";
export type EntryState = "open" | "not_started" | "closed" | "unavailable";
export function entryState(
  tournament: { status: TournamentStatus; entryStartAt: Date | null; entryEndAt: Date },
  category: { entryEndAt: Date | null },
  now: Date,
): EntryState {
  if (tournament.status === "draft" || tournament.status === "archived") return "unavailable";
  if (tournament.status === "closed") return "closed";
  if (tournament.entryStartAt && now < tournament.entryStartAt) return "not_started";
  if (now > effectiveDeadline(category, tournament)) return "closed";
  return "open";
}
export function isEntryOpen(
  tournament: Parameters<typeof entryState>[0], category: { entryEndAt: Date | null }, now: Date,
): boolean {
  return entryState(tournament, category, now) === "open";
}
// テスト必須ケース: 締切日 9/30 → 日本時間 9/30 23:59:59 は受付、10/1 0:00 は締切後（TZ=UTC でも同じ）、closed は期間内でも不可
```

