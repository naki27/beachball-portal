import { and, eq, gt, inArray } from "drizzle-orm";
import { type TeamInvitationKind, type TeamInvitationStatus, teamInvitations } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 選手・代表者としての招待（team_invitations・設計書 §5.15）のリポジトリ。すべて withTenant の tx の中で、associationId を必ず渡して呼ぶ
// 状態: pending → accepted / rejected / cancelled / expired。再送は同じ行の expires_at を延ばす（expired は pending に戻す）

export type TeamInvitationRow = typeof teamInvitations.$inferSelect;

export async function findTeamInvitation(tx: Tx, associationId: string, invitationId: string): Promise<TeamInvitationRow | null> {
  const [row] = await tx
    .select()
    .from(teamInvitations)
    .where(and(eq(teamInvitations.associationId, associationId), eq(teamInvitations.id, invitationId)))
    .limit(1);
  return row ?? null;
}

// 行をロックして読む（承諾・拒否の再検査用）
export async function lockTeamInvitation(tx: Tx, associationId: string, invitationId: string): Promise<TeamInvitationRow | null> {
  const [row] = await tx
    .select()
    .from(teamInvitations)
    .where(and(eq(teamInvitations.associationId, associationId), eq(teamInvitations.id, invitationId)))
    .limit(1)
    .for("update");
  return row ?? null;
}

// その人物への返事待ちの選手としての招待（協会内で 1 件まで・§5.15）。どのチームからでも
export async function findPendingPlayerInvitation(tx: Tx, associationId: string, memberId: string, now: Date): Promise<TeamInvitationRow | null> {
  const [row] = await tx
    .select()
    .from(teamInvitations)
    .where(
      and(
        eq(teamInvitations.associationId, associationId),
        eq(teamInvitations.kind, "player"),
        eq(teamInvitations.memberId, memberId),
        eq(teamInvitations.status, "pending"),
        gt(teamInvitations.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

// 同じチームから同じ人物（選手）／同じアドレス（代表者）への、再送できる行（pending・expired）
export async function findReusableTeamInvitation(
  tx: Tx,
  associationId: string,
  teamId: string,
  target: { kind: "player"; memberId: string } | { kind: "admin"; email: string },
): Promise<TeamInvitationRow | null> {
  const [row] = await tx
    .select()
    .from(teamInvitations)
    .where(
      and(
        eq(teamInvitations.associationId, associationId),
        eq(teamInvitations.teamId, teamId),
        eq(teamInvitations.kind, target.kind),
        target.kind === "player" ? eq(teamInvitations.memberId, target.memberId) : eq(teamInvitations.email, target.email),
        inArray(teamInvitations.status, ["pending", "expired"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertTeamInvitation(
  tx: Tx,
  associationId: string,
  input: { id: string; teamId: string; kind: TeamInvitationKind; memberId: string | null; email: string; invitedBy: string; expiresAt: Date },
): Promise<void> {
  await tx.insert(teamInvitations).values({ associationId, ...input });
}

export async function updateTeamInvitation(
  tx: Tx,
  associationId: string,
  invitationId: string,
  patch: Partial<Pick<TeamInvitationRow, "status" | "expiresAt" | "respondedAt" | "email">>,
): Promise<void> {
  await tx
    .update(teamInvitations)
    .set(patch)
    .where(and(eq(teamInvitations.associationId, associationId), eq(teamInvitations.id, invitationId)));
}

// チームの招待（状態で絞る）。選手一覧の「招待中」の表示用
export function listTeamInvitations(tx: Tx, associationId: string, teamId: string, statuses: TeamInvitationStatus[]): Promise<TeamInvitationRow[]> {
  return tx
    .select()
    .from(teamInvitations)
    .where(and(eq(teamInvitations.associationId, associationId), eq(teamInvitations.teamId, teamId), inArray(teamInvitations.status, statuses)));
}

// チームの返事待ち（期限切れを含む）の招待をすべて取り消す（無効化・削除のとき・§5.11）。取り消した数を返す
export async function cancelOpenTeamInvitations(tx: Tx, associationId: string, teamId: string, now: Date): Promise<number> {
  const rows = await tx
    .update(teamInvitations)
    .set({ status: "cancelled", respondedAt: now })
    .where(
      and(eq(teamInvitations.associationId, associationId), eq(teamInvitations.teamId, teamId), inArray(teamInvitations.status, ["pending", "expired"])),
    )
    .returning({ id: teamInvitations.id });
  return rows.length;
}
