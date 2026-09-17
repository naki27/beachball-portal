## 付録 F. 会員資格の判定（年度別）

```ts
// src/lib/membership.ts
// 年度を渡さずに会員判定を呼べないようにする（引数を省略できない形にする）
// 日付は日本時間の年月日（付録 D の PlainDate）。今日の年度は fiscalYearOf(todayInTokyo(), startMonth)
export function fiscalYearOf(date: PlainDate, startMonth: number): number {
  return date.month >= startMonth ? date.year : date.year - 1;  // 4月開始なら 3月は前年度
}
// 申込一覧の会員区分は、大会の開催日の年度で判定する（§5.12）

export async function isMember(
  db: Db, associationId: string, memberId: string, year: number,
): Promise<boolean> {
  const row = await db.memberships.findOne({ associationId, memberId, year });
  return row?.status === "approved";
}

// 画面・CSV の表示用（§5.12）。isMember の結果は変えず、表示のしかただけを決める
//   no_data:         その年度の受付も取り込みもない → 画面には出さない。CSV は空欄（v0.9.2）
//   renewal_pending: 受付期間中（締切前）で、昨年度は approved、今年度の行がまだない
//                    →「更新の受付中（昨年度は協会員）」（v0.9.2。受付が年度の初めの 3 か月にあるため）
export type MembershipDisplay = "member" | "pending" | "renewal_pending" | "not_member" | "no_data";
export async function membershipDisplay(
  db: Db, associationId: string, memberId: string, year: number, now: Date,
): Promise<MembershipDisplay> {
  const period = await db.membershipPeriods.findOne({ associationId, year });
  const imported = await db.memberships.exists({ associationId, year, source: "import" });
  if (!period && !imported) return "no_data";
  const row = await db.memberships.findOne({ associationId, memberId, year });
  if (row?.status === "approved") return "member";
  if (row?.status === "applied") return "pending";
  if (!row && period && now <= period.closesAt) {
    const last = await db.memberships.findOne({ associationId, memberId, year: year - 1 });
    if (last?.status === "approved") return "renewal_pending";
  }
  return "not_member";
}
```

テスト必須ケース: 年度開始月の前日と当日（3/31 と 4/1）、前年度 `approved` の人が新年度では非会員になること（`isMember`）、`applied` はまだ会員ではないこと、受付も取り込みもない年度は `no_data` になること、受付期間中で昨年度 `approved`・今年度の行なしなら `renewal_pending`、締切後は `not_member` になること。
