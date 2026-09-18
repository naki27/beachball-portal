import { and, eq } from "drizzle-orm";
import { type TeamKind, teams } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { type ReadOptions, tenantScope } from "./scope";

export type Team = typeof teams.$inferSelect;

export type NewTeam = {
  name: string;
  kana?: string | null;
  kind?: TeamKind;
  contactEmail?: string | null;
  contactPhone?: string | null;
  membershipRenewalTarget?: boolean;
  createdBy?: string | null;
};

// チームのリポジトリ。すべて withTenant の tx の中で、associationId を必ず渡して呼ぶ
export function listTeams(tx: Tx, associationId: string, options?: ReadOptions): Promise<Team[]> {
  return tx.select().from(teams).where(tenantScope(teams, associationId, options)).orderBy(teams.createdAt);
}

export async function findTeam(
  tx: Tx,
  associationId: string,
  teamId: string,
  options?: ReadOptions,
): Promise<Team | null> {
  const [row] = await tx
    .select()
    .from(teams)
    .where(and(tenantScope(teams, associationId, options), eq(teams.id, teamId)))
    .limit(1);
  return row ?? null;
}

export async function createTeam(tx: Tx, associationId: string, input: NewTeam): Promise<Team> {
  const [row] = await tx
    .insert(teams)
    .values({ associationId, ...input })
    .returning();
  return row;
}

// 論理削除（§5.16）。削除済みか、ほかの協会の行なら false
export async function softDeleteTeam(tx: Tx, associationId: string, teamId: string, deletedBy: string): Promise<boolean> {
  const rows = await tx
    .update(teams)
    .set({ deletedAt: new Date(), deletedBy })
    .where(and(tenantScope(teams, associationId), eq(teams.id, teamId)))
    .returning({ id: teams.id });
  return rows.length > 0;
}
