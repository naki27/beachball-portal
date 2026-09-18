import { describe, expect, it } from "vitest";
import type { Tx } from "@/db/tenant";
import { findMember } from "@/lib/repo/members";
import { findTeam, listTeams } from "@/lib/repo/teams";

// 型の検査（設計書 §5.14「漏れを機構で防ぐ」1）。@ts-expect-error は `pnpm typecheck` が確かめる
// （エラーにならなければ typecheck が失敗する）。ここでは呼び出しを実行しない
describe("リポジトリ関数の型", () => {
  const tx = null as unknown as Tx;

  it("associationId を省略すると型エラーになる", () => {
    const calls = [
      // @ts-expect-error associationId は省略できない
      () => listTeams(tx),
      // @ts-expect-error associationId は省略できない
      () => findTeam(tx, "00000000-0000-4000-8000-000000000000"),
      // @ts-expect-error associationId は省略できない
      () => findMember(tx, "00000000-0000-4000-8000-000000000000"),
    ];
    expect(calls).toHaveLength(3);
  });
});
