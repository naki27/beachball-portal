import type { MembershipStatus } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { fiscalYear, type PlainDate } from "@/lib/date";
import { findMembershipPeriod, hasImportedMemberships, listMembershipRows } from "@/lib/repo/memberships";

// 会員判定（設計書 §5.12・付録 F）。協会員かどうかを決めるのはこのファイルだけ
// **年度を渡さずに呼べない**（引数を省略できない形）。年度は開始年（2026 年度 = 2026/4〜2027/3）で、
// 「今日の年度」は fiscalYearOf(todayInTokyo(), association.fiscalYearStartMonth)、申込一覧は大会の開催日の年度で判定する
// withTenant の tx の中で呼ぶ（協会をまたいで読まない）

// 年度の計算は date.ts の fiscalYear が唯一の実装。ここは付録 F の名前で呼べるようにするだけ
export function fiscalYearOf(date: PlainDate, startMonth: number): number {
  return fiscalYear(date, startMonth);
}

// 画面・CSV の表示用（§5.12・§4.4）。isMember の結果は変えず、表示のしかただけを決める
//   member:          その年度に approved
//   pending:         applied（運営の確認待ち）
//   renewal_pending: 受付期間中（締切前）で、昨年度は approved、今年度の行がまだない →「更新の受付中（昨年度は協会員）」
//   not_member:      それ以外（declined・expired・行なし）
//   no_data:         その年度の受付も取り込みもない → 画面には出さない。CSV は空欄
export type MembershipDisplay = "member" | "pending" | "renewal_pending" | "not_member" | "no_data";

type StatusRow = { status: MembershipStatus } | null | undefined;

// 判定の材料（読んだ行を渡す。純粋関数なので画面・CSV・テストで同じ結果になる）
export type MembershipFacts = {
  period: { closesAt: Date } | null;
  imported: boolean;
  row: StatusRow;
  lastYearRow: StatusRow;
};

export function isApproved(row: StatusRow): boolean {
  return row?.status === "approved";
}

export function membershipDisplayOf(facts: MembershipFacts, now: Date): MembershipDisplay {
  if (!facts.period && !facts.imported) return "no_data";
  if (facts.row?.status === "approved") return "member";
  if (facts.row?.status === "applied") return "pending";
  if (!facts.row && facts.period && now.getTime() <= facts.period.closesAt.getTime() && isApproved(facts.lastYearRow)) {
    return "renewal_pending";
  }
  return "not_member";
}

// 画面の言い方（§4.4 の対応表）。no_data は出さない（null）
export function membershipDisplayLabel(display: MembershipDisplay, year: number): string | null {
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

// その年度の協会員か（approved だけ。applied はまだ会員ではない・前年度の approved は今年度の会員ではない）
export async function isMember(tx: Tx, associationId: string, memberId: string, year: number): Promise<boolean> {
  const rows = await listMembershipRows(tx, associationId, [memberId], [year]);
  return isApproved(rows.get(memberId)?.get(year));
}

export async function membershipDisplay(tx: Tx, associationId: string, memberId: string, year: number, now: Date): Promise<MembershipDisplay> {
  const displays = await membershipDisplays(tx, associationId, [memberId], year, now);
  return displays.get(memberId) ?? "no_data";
}

// 何人分もまとめて（申込一覧・チーム管理の画面）。読むのは受付 1 行・取り込みの有無・2 年度分の行だけ
export async function membershipDisplays(
  tx: Tx,
  associationId: string,
  memberIds: readonly string[],
  year: number,
  now: Date,
): Promise<Map<string, MembershipDisplay>> {
  const result = new Map<string, MembershipDisplay>();
  if (memberIds.length === 0) return result;
  const period = await findMembershipPeriod(tx, associationId, year);
  const imported = await hasImportedMemberships(tx, associationId, year);
  const rows = await listMembershipRows(tx, associationId, memberIds, [year, year - 1]);
  for (const memberId of memberIds) {
    const byYear = rows.get(memberId);
    result.set(
      memberId,
      membershipDisplayOf(
        { period: period ? { closesAt: period.closesAt } : null, imported, row: byYear?.get(year), lastYearRow: byYear?.get(year - 1) },
        now,
      ),
    );
  }
  return result;
}
