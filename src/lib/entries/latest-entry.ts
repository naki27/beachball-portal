import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { findLatestEntryForTeam, listEntryPlayers } from "@/lib/repo/entries";
import { authorizeTeam } from "@/lib/teams/access";
import { TeamError } from "@/lib/teams/errors";
import type { PreviousPlayer } from "./copy-previous";

// 前回コピーの材料（設計書 §5.5(b)・§10 の GET /api/teams/:id/entries/latest）
// そのチームの直近の申込（取消・削除でないもの）の選手と、部の `code` を返す。
// 枠に戻すかどうかは画面が選手一覧と突き合わせて決める（copy-previous.ts）

export type LatestEntryForCopy = {
  entryId: string;
  tournamentName: string;
  categoryCode: string;
  categoryLabel: string;
  submittedAt: Date;
  players: PreviousPlayer[];
};

export async function getLatestEntryForCopy(
  db: Db,
  principal: Principal,
  associationId: string,
  teamId: string,
): Promise<LatestEntryForCopy | null> {
  if (!principal.userId) throw new TeamError(403, "ログインが必要です");
  const userId = principal.userId;
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      // 前回の選手の氏名を返すので、そのチームの代表者（以上）だけ（§3.2）
      await authorizeTeam(tx, { ...principal, userId }, associationId, teamId, "manageEntries");
      const latest = await findLatestEntryForTeam(tx, associationId, teamId);
      if (!latest) return null;
      const players = await listEntryPlayers(tx, associationId, latest.entryId);
      return {
        entryId: latest.entryId,
        tournamentName: latest.tournamentName,
        categoryCode: latest.categoryCode,
        categoryLabel: latest.categoryLabel,
        submittedAt: latest.submittedAt,
        // 生年月日は返さない（枠に戻す値は画面が選手一覧から取る・§12）
        players: players.map((player) => ({ memberId: player.memberId, name: player.name })),
      };
    },
    { userId },
  );
}
