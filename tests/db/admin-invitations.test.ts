import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  adminAccessLogs,
  associationAdminInvitations,
  associationAdmins,
  associations,
  categoryPresets,
  mailLogs,
  platformAdmins,
  sessions,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { createSession, loadSession } from "@/lib/auth/session";
import { acceptAdminInvitation, InvitationError, rejectAdminInvitation } from "@/lib/invitations/admin-accept";
import { processMailQueue } from "@/lib/mail/queue";
import type { MailSender, OutgoingMail } from "@/lib/mail/types";
import {
  cancelAdminInvitation,
  inviteAssociationAdmin,
  listAdminInvitations,
  removeAssociationAdmin,
  resendAdminInvitation,
} from "@/lib/platform/admin-invitations";
import { createAssociationTenant } from "@/lib/platform/associations";
import { listMyPendingInvitations } from "@/lib/repo/invitations";

// テナント管理者の招待（設計書 §5.14 の受け入れ条件）。操作は app_user、メールの送信は app_job、準備と後片付けは app_owner
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const NOW = new Date();
let platformUserId = "";
let associationId = "";
let associationSlug = "";
const createdUserIds: string[] = [];
const createdEmails: string[] = [];

async function newUser(email: string): Promise<string> {
  const [u] = await owner.insert(users).values({ email, emailVerifiedAt: NOW }).returning({ id: users.id });
  createdUserIds.push(u.id);
  createdEmails.push(email);
  return u.id;
}

function recordingSender(): MailSender & { sent: OutgoingMail[] } {
  const sent: OutgoingMail[] = [];
  return {
    sent,
    async send(mail) {
      sent.push(mail);
      return {};
    },
  };
}

beforeAll(async () => {
  platformUserId = await newUser(`platform-inv-${random()}@example.com`);
  await owner.insert(platformAdmins).values({ userId: platformUserId, note: "test" });
  associationSlug = `inv-${random()}`;
  const { association } = await createAssociationTenant(app, platformUserId, { name: "招待テスト協会", slug: associationSlug, adminEmails: ["first@example.com"] }, NOW);
  associationId = association.id;
  createdEmails.push("first@example.com");
});

afterAll(async () => {
  await withTenantOn(owner, associationId, async (tx) => {
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, associationId));
    await tx.delete(associationAdminInvitations).where(eq(associationAdminInvitations.associationId, associationId));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, associationId));
  });
  await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.associationId, associationId));
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, associationId));
  await owner.delete(associations).where(eq(associations.id, associationId));
  for (const id of createdUserIds) {
    await owner.delete(sessions).where(eq(sessions.userId, id));
    await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.userId, id));
  }
  await owner.delete(platformAdmins).where(eq(platformAdmins.userId, platformUserId));
  for (const id of createdUserIds) await owner.delete(users).where(eq(users.id, id));
  await closeDb(app);
  await closeDb(job);
  await closeDb(owner);
});

describe("招待・再送・取り消し（運営管理者）", () => {
  it("作成時の招待と、あとからの招待はメールが送信待ちに積まれ、本文に協会名・URL・アドレス・期限が入る", async () => {
    const email = `invitee-${random()}@example.com`;
    createdEmails.push(email);
    const { invitationId, resent } = await inviteAssociationAdmin(app, platformUserId, associationId, email.toUpperCase(), NOW);
    expect(resent).toBe(false);

    const sender = recordingSender();
    await processMailQueue(job, sender);
    const first = sender.sent.find((m) => m.to === "first@example.com");
    const mine = sender.sent.find((m) => m.to === email);
    expect(first?.subject).toBe("【招待テスト協会】協会の管理者への招待");
    expect(mine?.text).toContain(`/${associationSlug}/`);
    expect(mine?.text).toContain(email);
    expect(mine?.text).toMatch(/期限: \d+月\d+日（[日月火水木金土]）まで/);
    expect(mine?.text).toContain("いつものブラウザ");

    const rows = await listAdminInvitations(app, platformUserId, associationId);
    expect(rows.find((r) => r.id === invitationId)?.status).toBe("pending");

    // 同じアドレスへの 2 回目は同じ行の再送（返事待ちを重ねない）
    const again = await inviteAssociationAdmin(app, platformUserId, associationId, email, NOW);
    expect(again).toEqual({ invitationId, resent: true });
    expect((await listAdminInvitations(app, platformUserId, associationId)).filter((r) => r.email === email)).toHaveLength(1);
  });

  it("管理者と返事待ちの招待が合わせて 5 名の協会には、それ以上招待できない", async () => {
    // いま: first + invitee = 2 件の返事待ち。あと 3 件で 5
    for (let i = 0; i < 3; i++) {
      const email = `filler-${random()}@example.com`;
      createdEmails.push(email);
      await inviteAssociationAdmin(app, platformUserId, associationId, email, NOW);
    }
    await expect(inviteAssociationAdmin(app, platformUserId, associationId, `over-${random()}@example.com`, NOW)).rejects.toMatchObject({ status: 409 });
    // 1 件取り消せば招待できる
    const filler = (await listAdminInvitations(app, platformUserId, associationId)).find((r) => r.email.startsWith("filler-"))!;
    await cancelAdminInvitation(app, platformUserId, associationId, filler.id, NOW);
    expect((await listAdminInvitations(app, platformUserId, associationId)).find((r) => r.id === filler.id)?.status).toBe("cancelled");
    await expect(cancelAdminInvitation(app, platformUserId, associationId, filler.id, NOW)).rejects.toMatchObject({ status: 409 });
    await expect(resendAdminInvitation(app, platformUserId, associationId, filler.id, NOW)).rejects.toMatchObject({ status: 409 });
    // 残りの filler も取り消して、あとのテストの枠を空ける
    for (const r of (await listAdminInvitations(app, platformUserId, associationId)).filter((r) => r.email.startsWith("filler-") && r.status === "pending")) {
      await cancelAdminInvitation(app, platformUserId, associationId, r.id, NOW);
    }
  });
});

describe("承諾・拒否（本人）", () => {
  it("招待しただけでは権限は付かず、本人が承諾すると付く。承諾でほかのセッションが終わる", async () => {
    const email = `accepter-${random()}@example.com`;
    const userId = await newUser(email);
    const { invitationId } = await inviteAssociationAdmin(app, platformUserId, associationId, email, NOW);

    // 招待だけ: 管理者の行はない
    const before = await withTenantOn(owner, associationId, (tx) => tx.select().from(associationAdmins).where(and(eq(associationAdmins.associationId, associationId), eq(associationAdmins.userId, userId))));
    expect(before).toHaveLength(0);

    // 本人には招待が見える
    const mine = await listMyPendingInvitations(app, userId);
    expect(mine.map((i) => i.invitationId)).toContain(invitationId);
    expect(mine.find((i) => i.invitationId === invitationId)).toMatchObject({ kind: "association_admin", associationSlug });

    const keep = await createSession(app, userId, NOW);
    const other = await createSession(app, userId, NOW);
    const result = await acceptAdminInvitation(app, userId, keep.id, invitationId, NOW);
    expect(result).toEqual({ associationSlug, associationName: "招待テスト協会" });

    const after = await withTenantOn(owner, associationId, (tx) => tx.select().from(associationAdmins).where(and(eq(associationAdmins.associationId, associationId), eq(associationAdmins.userId, userId))));
    expect(after).toHaveLength(1);
    expect(after[0].grantedBy).toBe(platformUserId);
    expect((await listAdminInvitations(app, platformUserId, associationId)).find((r) => r.id === invitationId)?.status).toBe("accepted");
    expect(await loadSession(app, keep.id, NOW)).not.toBeNull();
    expect(await loadSession(app, other.id, NOW)).toBeNull();
    // 2 回目は承諾できない
    await expect(acceptAdminInvitation(app, userId, keep.id, invitationId, NOW)).rejects.toBeInstanceOf(InvitationError);

    // 解除
    await removeAssociationAdmin(app, platformUserId, associationId, userId);
    const removed = await withTenantOn(owner, associationId, (tx) => tx.select().from(associationAdmins).where(eq(associationAdmins.userId, userId)));
    expect(removed).toHaveLength(0);
  });

  it("招待と違うメールアドレスでログインしたアカウントは承諾できない（見えもしない）", async () => {
    const invited = `invited-${random()}@example.com`;
    createdEmails.push(invited);
    const { invitationId } = await inviteAssociationAdmin(app, platformUserId, associationId, invited, NOW);
    const strangerId = await newUser(`stranger-${random()}@example.com`);
    const session = await createSession(app, strangerId, NOW);
    expect((await listMyPendingInvitations(app, strangerId)).map((i) => i.invitationId)).not.toContain(invitationId);
    await expect(acceptAdminInvitation(app, strangerId, session.id, invitationId, NOW)).rejects.toMatchObject({ status: 404 });
    const row = (await listAdminInvitations(app, platformUserId, associationId)).find((r) => r.id === invitationId);
    expect(row?.status).toBe("pending");
  });

  it("期限切れは承諾できない。「心当たりがない」で無効になり、招待した運営管理者にメールが積まれる", async () => {
    const email = `late-${random()}@example.com`;
    const userId = await newUser(email);
    const { invitationId } = await inviteAssociationAdmin(app, platformUserId, associationId, email, NOW);
    const session = await createSession(app, userId, NOW);
    const later = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    await expect(acceptAdminInvitation(app, userId, session.id, invitationId, later)).rejects.toMatchObject({ status: 409 });

    await rejectAdminInvitation(app, userId, invitationId, NOW);
    expect((await listAdminInvitations(app, platformUserId, associationId)).find((r) => r.id === invitationId)?.status).toBe("rejected");
    const queued = await owner
      .select()
      .from(mailLogs)
      .where(and(eq(mailLogs.associationId, associationId), eq(mailLogs.mailType, "association_admin_invitation_rejected")));
    expect(queued.length).toBeGreaterThanOrEqual(1);
    expect(queued[0].userId).toBe(platformUserId);
    const sender = recordingSender();
    await processMailQueue(job, sender);
    const notice = sender.sent.find((m) => m.subject.includes("断られました"));
    expect(notice?.text).toContain(email);
  });
});
