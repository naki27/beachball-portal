import type { MembershipStatus } from "@/db/schema/memberships";
import type { Tx } from "@/db/tenant";
import { fiscalYear, type PlainDate, todayInTokyo } from "@/lib/date";
import {
  findMembership,
  findMembershipPeriod,
  hasImportedMemberships,
  listMembershipStatuses,
  type MembershipPeriod,
} from "@/lib/repo/memberships";

// 会員判定はここ 1 か所（設計書 §5.12・付録 F）。ほかの場所で status を直に見て「会員かどうか」を決めない
//
// **年度を渡さずに呼べない形にする**（§5.12 受け入れ条件）。会員資格は年度で切り替わり、
// 前年度の `approved` は今年度の会員ではない。年度は開始年（2026 年度 = 2026/4〜2027/3）で、
// 開始月は協会ごと（`associations.fiscal_year_start_month`）
//
// 表示（membershipDisplay）は isMember の結果を変えない。「更新の受付中（昨年度は協会員）」は表示だけの区分

// 年度（開始年）。日付の計算そのものは date.ts が唯一の実装（付録 F の fiscalYearOf はこの名前で呼べるようにしたもの）
export function fiscalYearOf(date: PlainDate, startMonth: number): number {
  return fiscalYear(date, startMonth);
}

// 「今年度」。今日は todayInTokyo() だけから取る（§7.0）
export function currentFiscalYear(startMonth: number, now: Date = new Date()): number {
  return fiscalYearOf(todayInTokyo(now), startMonth);
}

// 申込一覧・CSV の会員区分は**大会の開催日が属する年度**で判定する（§5.12「表示」）。開催日が未定なら今日の年度
export function fiscalYearForTournament(eventDate: PlainDate | null, startMonth: number, now: Date = new Date()): number {
  return fiscalYearOf(eventDate ?? todayInTokyo(now), startMonth);
}

//   member:          その年度の協会員（approved）
//   pending:         申告済みで運営の確認待ち（applied）。**まだ会員ではない**
//   renewal_pending: 受付期間中（締切前）で、昨年度は approved、今年度の行がまだない
//   not_member:      協会員ではない（declined・行なし・受付の締切後）
//   no_data:         その年度のデータがない（受付も取り込みもない）→ 画面に出さない・CSV は空欄
export type MembershipDisplay = "member" | "pending" | "renewal_pending" | "not_member" | "no_data";

// 画面の文言（§4.4 の対応表）。no_data は出さない（null）
export function membershipDisplayText(display: MembershipDisplay, year: number): string | null {
  switch (display) {
    case "member":
      return `協会員（${year}年度）`;
    case "pending":
      return "運営の確認待ち";
    case "renewal_pending":
      return "更新の受付中（昨年度は協会員）";
    case "not_member":
      return "協会員ではない";
    case "no_data":
      return null;
  }
}

// CSV の「協会員区分」の値（§5.5(f)）。データのない年度は空欄（列は残す）
export function membershipCsvText(display: MembershipDisplay): string {
  switch (display) {
    case "member":
      return "協会員";
    case "pending":
      return "確認待ち";
    case "renewal_pending":
      return "更新の受付中";
    case "not_member":
      return "非会員";
    case "no_data":
      return "";
  }
}

// 判定に必要な事実。DB から読む部分と判定を分けて、表（付録 F）そのものを試験できるようにする
export type MembershipFacts = {
  // その年度の行（なければ null）
  current: MembershipStatus | null;
  // 前年度の行（なければ null）
  previous: MembershipStatus | null;
  // その年度の受付（なければ null）
  period: { closesAt: Date } | null;
  // その年度に取り込みのデータがあるか
  imported: boolean;
};

// 会員かどうか（付録 F の isMember）。approved だけが会員。applied はまだ会員ではない
export function isMemberStatus(status: MembershipStatus | null): boolean {
  return status === "approved";
}

// 表示の区分（付録 F の membershipDisplay）。事実 → 区分の対応はここだけ
export function decideMembershipDisplay(facts: MembershipFacts, now: Date): MembershipDisplay {
  if (!facts.period && !facts.imported) return "no_data";
  if (facts.current === "approved") return "member";
  if (facts.current === "applied") return "pending";
  // 受付期間中（締切前）で今年度の行がなく、昨年度が協会員なら「更新の受付中」
  if (facts.current === null && facts.period && now <= facts.period.closesAt && facts.previous === "approved") {
    return "renewal_pending";
  }
  return "not_member";
}

// ここから下は DB を読む版（年度を省略できない）

export async function isMember(tx: Tx, associationId: string, memberId: string, year: number): Promise<boolean> {
  const row = await findMembership(tx, associationId, memberId, year);
  return isMemberStatus(row?.status ?? null);
}

export async function membershipDisplay(
  tx: Tx,
  associationId: string,
  memberId: string,
  year: number,
  now: Date,
): Promise<MembershipDisplay> {
  const [period, imported, current] = await Promise.all([
    findMembershipPeriod(tx, associationId, year),
    hasImportedMemberships(tx, associationId, year),
    findMembership(tx, associationId, memberId, year),
  ]);
  // 前年度は「更新の受付中」の判定に使うときだけ読む
  const previous = current === null && period ? await findMembership(tx, associationId, memberId, year - 1) : null;
  return decideMembershipDisplay(
    { current: current?.status ?? null, previous: previous?.status ?? null, period, imported },
    now,
  );
}

// 一覧・CSV 用（1 人ずつ問い合わせない）。渡した人物ごとの区分を返す
export async function membershipDisplays(
  tx: Tx,
  associationId: string,
  memberIds: readonly string[],
  year: number,
  now: Date,
): Promise<Map<string, MembershipDisplay>> {
  const [period, imported] = await Promise.all([
    findMembershipPeriod(tx, associationId, year),
    hasImportedMemberships(tx, associationId, year),
  ]);
  const result = new Map<string, MembershipDisplay>();
  if (!period && !imported) {
    for (const memberId of memberIds) result.set(memberId, "no_data");
    return result;
  }
  const current = await listMembershipStatuses(tx, associationId, year, memberIds);
  // 今年度の行がない人だけ、前年度を見る（「更新の受付中」の判定）
  const missing = memberIds.filter((memberId) => !current.has(memberId));
  const previous: Map<string, MembershipStatus> =
    period && missing.length > 0 ? await listMembershipStatuses(tx, associationId, year - 1, missing) : new Map();
  for (const memberId of memberIds) {
    result.set(
      memberId,
      decideMembershipDisplay(
        { current: current.get(memberId) ?? null, previous: previous.get(memberId) ?? null, period, imported },
        now,
      ),
    );
  }
  return result;
}

// その年度の受付の状態（D-02 以降で使う）。受付がなければ null
export type RenewalState = "not_started" | "open" | "closed";

export function renewalState(period: MembershipPeriod | null, now: Date): RenewalState | null {
  if (!period) return null;
  if (now < period.opensAt) return "not_started";
  return now <= period.closesAt ? "open" : "closed";
}

// 渡した人物のうち、その年度の協会員（approved）だけ（申込の「協会員だけを表示」・サジェストの絞り込み・§5.5）
// status を直に見る場所を増やさないため、画面・API はこれを通す
export async function listMembers(tx: Tx, associationId: string, year: number, memberIds: readonly string[]): Promise<Set<string>> {
  const statuses = await listMembershipStatuses(tx, associationId, year, memberIds);
  const members = new Set<string>();
  for (const [memberId, status] of statuses) if (isMemberStatus(status)) members.add(memberId);
  return members;
}
