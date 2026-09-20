import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  contactMessages,
  deletionLogs,
  mailLogs,
  memberAliases,
  members,
  teamInvitations,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { deleteMemberByAdmin } from "@/lib/admin/members";
import { deleteTeam } from "@/lib/admin/teams";
import { countTrash, listTrash, purgeFromTrash, restoreFromTrash } from "@/lib/admin/trash";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { deleteAssociationContact, listAssociationContacts } from "@/lib/contact-admin";
import { submitContactMessage } from "@/lib/contact";
import { normalizeName } from "@/lib/normalize";
import { listActiveRoster } from "@/lib/repo/team-members";
import { listTeamNames } from "@/lib/repo/teams";
import { TeamError } from "@/lib/teams/errors";
import { invitePlayer } from "@/lib/teams/invitations";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 削除済みデータと物理削除（設計書 §5.16 の受け入れ条件）。テナント管理者だけ
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const S = SAWARA_ASSOCIATION_ID;
const tag = `ゴミ箱${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const ids = { captain: "", tenantAdmin: "" };
const emails = { captain: "", tenantAdmin: "" };
const player = { name: `${tag} 太郎`, kana: "", birthDate: "1991-04-05", sex: "male" };

async function statusOf(run: () => Promise<unknown>): Promise<number | "ok"> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

async function newTeam(name: string): Promise<string> {
  const team = await registerTeam(app, S, ids.captain, {
    name: `${tag} ${name}`,
    kana: null,
    contactEmail: null,
    contactPhone: null,
    membershipRenewalTarget: false,
  });
  return team.id;
}

beforeAll(async () => {
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    emails[key] = `trash-${key}-${random()}@example.com`;
    const [u] = await owner.insert(users).values({ email: emails[key], emailVerifiedAt: new Date() }).returning({ id: users.id });
    ids[key] = u.id;
  }
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: ids.tenantAdmin }));
});

afterAll(async () => {
  const userIds = Object.values(ids).filter(Boolean);
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(contactMessages).where(like(contactMessages.senderEmail, `%${tag}%`));
    if (userIds.length > 0) {
      await tx.delete(teamInvitations).where(inArray(teamInvitations.invitedBy, userIds));
      await tx.delete(teams).where(inArray(teams.createdBy, userIds));
    }
    await tx.delete(members).where(like(members.nameNormalized, `${normalizeName(tag)}%`));
  });
  if (userIds.length > 0) {
    await withTenantOn(owner, S, (tx) => tx.delete(deletionLogs).where(inArray(deletionLogs.deletedBy, userIds)));
  }
  await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%${tag}%`));
  await owner.delete(associationAdmins).where(inArray(associationAdmins.userId, userIds));
  await owner.delete(users).where(inArray(users.id, userIds));
  await closeDb(app);
  await closeDb(owner);
});

describe("削除済みデータ", () => {
  it("チームを削除すると一覧に出て、復元すると元どおりになる", async () => {
    const teamId = await newTeam("復元チーム");
    await addPlayer(app, as(ids.captain), S, teamId, player);
    await deleteTeam(app, as(ids.tenantAdmin), S, teamId);

    // 削除済みは通常の一覧から消える
    const names = await withTenantOn(app, S, (tx) => listTeamNames(tx, S));
    expect(names.map((t) => t.id)).not.toContain(teamId);

    const items = await listTrash(app, as(ids.tenantAdmin), S, "teams");
    const item = items.find((i) => i.id === teamId);
    expect(item).toBeTruthy();
    expect(item?.detail).toContain("選手一覧の行 1 件");
    expect((await countTrash(app, as(ids.tenantAdmin), S)).teams).toBeGreaterThanOrEqual(1);

    await restoreFromTrash(app, as(ids.tenantAdmin), S, "teams", teamId);
    const after = await withTenantOn(app, S, (tx) => listTeamNames(tx, S));
    expect(after.map((t) => t.id)).toContain(teamId);
    expect((await listTrash(app, as(ids.tenantAdmin), S, "teams")).map((i) => i.id)).not.toContain(teamId);
    // 選手一覧の行も元どおり
    expect((await withTenantOn(app, S, (tx) => listActiveRoster(tx, S, teamId))).length).toBe(1);
  });

  it("代表者は削除済みデータを読めず、物理削除もできない（403）", async () => {
    const teamId = await newTeam("403チーム");
    await deleteTeam(app, as(ids.tenantAdmin), S, teamId);
    expect(await statusOf(() => listTrash(app, as(ids.captain), S, "teams"))).toBe(403);
    expect(await statusOf(() => countTrash(app, as(ids.captain), S))).toBe(403);
    expect(await statusOf(() => restoreFromTrash(app, as(ids.captain), S, "teams", teamId))).toBe(403);
    expect(await statusOf(() => purgeFromTrash(app, as(ids.captain), S, "teams", teamId, "誤登録"))).toBe(403);
    // 消えていない
    expect((await listTrash(app, as(ids.tenantAdmin), S, "teams")).map((i) => i.id)).toContain(teamId);
  });

  it("削除していないものは物理削除できない（409）", async () => {
    const teamId = await newTeam("生きているチーム");
    expect(await statusOf(() => purgeFromTrash(app, as(ids.tenantAdmin), S, "teams", teamId, "誤登録"))).toBe(409);
    expect((await withTenantOn(app, S, (tx) => listTeamNames(tx, S))).map((t) => t.id)).toContain(teamId);
    // 理由がなければ 400
    await deleteTeam(app, as(ids.tenantAdmin), S, teamId);
    expect(await statusOf(() => purgeFromTrash(app, as(ids.tenantAdmin), S, "teams", teamId, "   "))).toBe(400);
  });

  it("チームを物理削除すると、選手一覧の行・代表者・招待も消え、人物は残る。deletion_logs に中身は残らない", async () => {
    const teamId = await newTeam("完全削除チーム");
    const added = await addPlayer(app, as(ids.captain), S, teamId, player);
    await invitePlayer(app, as(ids.captain), S, teamId, { memberId: added.memberId, email: `invite-${tag}@example.com` });
    await deleteTeam(app, as(ids.tenantAdmin), S, teamId);

    const result = await purgeFromTrash(app, as(ids.tenantAdmin), S, "teams", teamId, "誤登録");
    // 選手一覧の行 1・代表者 1・招待 1（招待はチームの無効化ではなく削除で取り消し済みだが行は残る）
    expect(result.cascadedCount).toBeGreaterThanOrEqual(3);

    const rows = await withTenantOn(owner, S, (tx) => tx.select().from(teams).where(eq(teams.id, teamId)));
    expect(rows).toHaveLength(0);
    expect(await withTenantOn(owner, S, (tx) => tx.select().from(teamMembers).where(eq(teamMembers.teamId, teamId)))).toHaveLength(0);
    expect(await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.teamId, teamId)))).toHaveLength(0);
    // 人物は協会のデータとして残る
    const person = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, added.memberId)));
    expect(person).toHaveLength(1);

    const [log] = await withTenantOn(owner, S, (tx) => tx.select().from(deletionLogs).where(eq(deletionLogs.recordId, teamId)));
    expect(log).toMatchObject({ tableName: "teams", reason: "誤登録", deletedBy: ids.tenantAdmin, associationId: S });
    expect(log.cascadedCount).toBe(result.cascadedCount);
    // 中身（氏名・チーム名）は記録しない
    expect(JSON.stringify(log)).not.toContain(tag);
  });

  it("人物を削除すると選手一覧から消え、物理削除で別名と招待も消える。同じ氏名・生年月日で登録し直せる", async () => {
    const teamId = await newTeam("人物チーム");
    const added = await addPlayer(app, as(ids.captain), S, teamId, player);
    const memberId = added.memberId;
    await invitePlayer(app, as(ids.captain), S, teamId, { memberId, email: `person-${tag}@example.com` });

    await deleteMemberByAdmin(app, as(ids.tenantAdmin), S, memberId);
    // すべての選手一覧から消える
    expect(await withTenantOn(app, S, (tx) => listActiveRoster(tx, S, teamId))).toHaveLength(0);
    expect((await listTrash(app, as(ids.tenantAdmin), S, "members")).map((i) => i.id)).toContain(memberId);

    const result = await purgeFromTrash(app, as(ids.tenantAdmin), S, "members", memberId, "本人からの依頼");
    expect(result.cascadedCount).toBeGreaterThanOrEqual(2);
    expect(await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, memberId)))).toHaveLength(0);
    expect(await withTenantOn(owner, S, (tx) => tx.select().from(memberAliases).where(eq(memberAliases.memberId, memberId)))).toHaveLength(0);
    expect(await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.memberId, memberId)))).toHaveLength(0);
    // チームは残る
    expect((await withTenantOn(app, S, (tx) => listTeamNames(tx, S))).map((t) => t.id)).toContain(teamId);

    // 同じ氏名・生年月日で登録し直せる
    const again = await addPlayer(app, as(ids.captain), S, teamId, player);
    expect(again.memberId).not.toBe(memberId);
  });

  it("選手一覧の行は、チームが削除済みのままだと復元できない", async () => {
    const teamId = await newTeam("親チーム");
    const added = await addPlayer(app, as(ids.captain), S, teamId, { ...player, name: `${tag} 花子` });
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamMembers).where(eq(teamMembers.memberId, added.memberId)));
    await withTenantOn(owner, S, (tx) =>
      tx.update(teamMembers).set({ deletedAt: new Date(), deletedBy: ids.tenantAdmin }).where(eq(teamMembers.id, row.id)),
    );
    await deleteTeam(app, as(ids.tenantAdmin), S, teamId);

    const item = (await listTrash(app, as(ids.tenantAdmin), S, "team_members")).find((i) => i.id === row.id);
    expect(item?.restoreBlockedBy).toContain("チームが削除されています");
    expect(await statusOf(() => restoreFromTrash(app, as(ids.tenantAdmin), S, "team_members", row.id))).toBe(409);

    await restoreFromTrash(app, as(ids.tenantAdmin), S, "teams", teamId);
    await restoreFromTrash(app, as(ids.tenantAdmin), S, "team_members", row.id);
    expect(await withTenantOn(app, S, (tx) => listActiveRoster(tx, S, teamId))).toHaveLength(1);
  });

  it("問い合わせは削除すると一覧から消え、復元でき、物理削除もできる", async () => {
    const senderEmail = `contact-${tag}@example.com`;
    const sent = await submitContactMessage(app, {
      type: "association",
      associationId: S,
      senderName: `${tag} 問合`,
      senderEmail,
      subjectType: "その他",
      body: "削除済みデータの試験",
      ip: "10.9.0.1",
    });
    if (!sent.ok) throw new Error("送信できていません");

    expect(await deleteAssociationContact(app, S, sent.messageId, ids.tenantAdmin)).toBe(true);
    expect((await listAssociationContacts(app, S)).map((r) => r.id)).not.toContain(sent.messageId);
    expect((await listTrash(app, as(ids.tenantAdmin), S, "contact_messages")).map((i) => i.id)).toContain(sent.messageId);

    await restoreFromTrash(app, as(ids.tenantAdmin), S, "contact_messages", sent.messageId);
    expect((await listAssociationContacts(app, S)).map((r) => r.id)).toContain(sent.messageId);

    await deleteAssociationContact(app, S, sent.messageId, ids.tenantAdmin);
    await purgeFromTrash(app, as(ids.tenantAdmin), S, "contact_messages", sent.messageId, "本人からの依頼");
    expect(
      await withTenantOn(owner, S, (tx) => tx.select().from(contactMessages).where(eq(contactMessages.id, sent.messageId))),
    ).toHaveLength(0);
    const [log] = await withTenantOn(owner, S, (tx) => tx.select().from(deletionLogs).where(eq(deletionLogs.recordId, sent.messageId)));
    expect(log).toMatchObject({ tableName: "contact_messages", cascadedCount: 0 });
    expect(JSON.stringify(log)).not.toContain(senderEmail);
  });
});
