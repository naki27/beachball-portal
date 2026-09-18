import type { Tx } from "@/db/tenant";

// 申込（entries）のリポジトリ。表は B-01 で作る。ここには、1a のうちに要る判定の口だけを置く

// 締切前で取り消していない申込の数（§5.11「チームの無効化と削除」: 残っていれば代表者は無効化・削除できない）
// B-01 で entries を作ったら、締切（deadline.ts）と状態で数える形に置き換える。それまでは常に 0
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function countOpenEntries(tx: Tx, associationId: string, teamId: string, now: Date): Promise<number> {
  return 0;
}
