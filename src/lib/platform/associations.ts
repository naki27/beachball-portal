import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { associationAdminInvitations, associations, associationSlugHistory, categoryPresets, sessions } from "@/db/schema";
import { setTenant } from "@/db/tenant";
import { hashSessionId } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/login-input";
import { enqueueMail } from "@/lib/mail/outbox";
import { DEFAULT_CATEGORY_PRESETS } from "@/lib/presets/default";
import { logAdminAccess } from "@/lib/repo/admin-access-logs";
import { type Association, resolveAssociationSlug } from "@/lib/repo/associations";
import { classifySlug } from "@/lib/slug";

// 運営管理者だけが行う操作（設計書 §5.14「テナントの作成」「URL とテナント」「運営管理者」）。呼ぶ側で運営管理者かを検査する

export const MAX_ADMINS_PER_ASSOCIATION = 5; // 返事待ちの招待も数える（§5.14）
export const ADMIN_INVITATION_DAYS = 7; // 【仮】
export const ENTER_TENANT_MINUTES = 60; // 入った状態の期限【仮】
export const MAX_ASSOCIATION_NAME_LENGTH = 100;

export class PlatformError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export type CreateAssociationInput = {
  name: string;
  slug: string;
  fiscalYearStartMonth?: number;
  contactEmail?: string | null;
  // 最初のテナント管理者（1 名以上・5 名まで）
  adminEmails: string[];
};

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new PlatformError(400, "協会名を入力してください", "name");
  if (trimmed.length > MAX_ASSOCIATION_NAME_LENGTH) throw new PlatformError(400, "協会名が長すぎます", "name");
  return trimmed;
}

function validateSlugFormat(slug: string): string {
  const s = slug.trim();
  if (classifySlug(s) !== "candidate") {
    throw new PlatformError(400, "URL の名前は英小文字・数字・ハイフンで 3〜30 文字にしてください（予約語は使えません）", "slug");
  }
  return s;
}

// 現行のスラッグと履歴のスラッグを合わせて一意（§5.14）
async function assertSlugAvailable(db: Db, slug: string): Promise<void> {
  if (await resolveAssociationSlug(db, slug)) {
    throw new PlatformError(409, "その URL の名前はすでに使われています（以前の名前も含めて）", "slug");
  }
}

function validateAdminEmails(emails: string[]): string[] {
  const given = emails.filter((e) => e.trim() !== "");
  if (given.length === 0) throw new PlatformError(400, "最初の管理者のメールアドレスを 1 つ以上入力してください", "adminEmails");
  const normalized: string[] = [];
  for (const raw of given) {
    const email = normalizeEmail(raw);
    if (!email) throw new PlatformError(400, "メールアドレスの形で入力してください", "adminEmails");
    if (!normalized.includes(email)) normalized.push(email); // 重複と大文字小文字の違いはまとめる
  }
  if (normalized.length > MAX_ADMINS_PER_ASSOCIATION) {
    throw new PlatformError(400, `管理者は 1 協会 ${MAX_ADMINS_PER_ASSOCIATION} 名までです`, "adminEmails");
  }
  return normalized;
}

// テナントの作成（§5.14）。協会の行・プリセットのコピー・最初の管理者への招待の行と招待のメール（送信待ち）・記録を
// 1 つのトランザクションで
export async function createAssociationTenant(
  db: Db,
  actorUserId: string,
  input: CreateAssociationInput,
  now: Date = new Date(),
): Promise<{ association: Association; invitationIds: string[] }> {
  const name = validateName(input.name);
  const slug = validateSlugFormat(input.slug);
  const month = input.fiscalYearStartMonth ?? 4;
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new PlatformError(400, "年度の開始月は 1〜12 です", "fiscalYearStartMonth");
  const contactEmail = input.contactEmail ? normalizeEmail(input.contactEmail) : null;
  if (input.contactEmail && !contactEmail) throw new PlatformError(400, "連絡先のメールアドレスの形で入力してください", "contactEmail");
  const adminEmails = validateAdminEmails(input.adminEmails);
  await assertSlugAvailable(db, slug);

  return db.transaction(async (tx) => {
    const [association] = await tx
      .insert(associations)
      .values({ name, slug, fiscalYearStartMonth: month, contactEmail })
      .returning();

    // ここから先はテナントの表。作ったばかりの協会に固定する
    await setTenant(tx, association.id, { userId: actorUserId });
    await tx
      .insert(categoryPresets)
      .values(DEFAULT_CATEGORY_PRESETS.map((preset) => ({ associationId: association.id, ...preset })));

    const invitationIds: string[] = [];
    for (const email of adminEmails) {
      const id = crypto.randomUUID();
      await tx.insert(associationAdminInvitations).values({
        id,
        associationId: association.id,
        email,
        invitedBy: actorUserId,
        expiresAt: new Date(now.getTime() + ADMIN_INVITATION_DAYS * 24 * 60 * 60 * 1000),
      });
      await enqueueMail(tx, {
        associationId: association.id,
        mailType: "association_admin_invitation",
        toEmail: email,
        params: { invitationId: id },
      });
      invitationIds.push(id);
    }

    await logAdminAccess(tx, { userId: actorUserId, associationId: association.id, action: "create_association", targetId: association.id });
    return { association, invitationIds };
  });
}

// 協会名・スラッグの変更（§5.14「URL とテナント」）。スラッグを変えたら旧スラッグを履歴に残し、恒久的に転送する
export async function updateAssociation(
  db: Db,
  actorUserId: string,
  associationId: string,
  input: { name?: string; slug?: string; contactEmail?: string | null },
): Promise<Association> {
  const [current] = await db.select().from(associations).where(eq(associations.id, associationId)).limit(1);
  if (!current) throw new PlatformError(400, "協会がありません");

  const name = input.name !== undefined ? validateName(input.name) : current.name;
  const slug = input.slug !== undefined ? validateSlugFormat(input.slug) : current.slug;
  const slugChanged = slug !== current.slug;
  if (slugChanged) await assertSlugAvailable(db, slug);
  let contactEmail = current.contactEmail;
  if (input.contactEmail !== undefined) {
    contactEmail = input.contactEmail ? normalizeEmail(input.contactEmail) : null;
    if (input.contactEmail && !contactEmail) throw new PlatformError(400, "連絡先のメールアドレスの形で入力してください", "contactEmail");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(associations)
      .set({ name, slug, contactEmail })
      .where(eq(associations.id, associationId))
      .returning();
    if (slugChanged) {
      await setTenant(tx, associationId, { userId: actorUserId });
      await tx.insert(associationSlugHistory).values({ slug: current.slug, associationId });
      await logAdminAccess(tx, { userId: actorUserId, associationId, action: "change_slug", targetId: associationId });
    }
    return updated;
  });
}

// 協会に「切り替えて入る」（§5.14）。入った状態はセッションに持ち、期限は 1 時間。記録を残す
export async function enterTenant(
  db: Db,
  actorUserId: string,
  sessionId: string,
  associationId: string,
  now: Date = new Date(),
): Promise<Date> {
  const [association] = await db.select({ id: associations.id }).from(associations).where(eq(associations.id, associationId)).limit(1);
  if (!association) throw new PlatformError(400, "協会がありません");
  const until = new Date(now.getTime() + ENTER_TENANT_MINUTES * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ enteredAssociationId: associationId, enteredUntil: until })
      .where(eq(sessions.sessionHash, hashSessionId(sessionId)));
    await logAdminAccess(tx, { userId: actorUserId, associationId, action: "enter_tenant", targetId: associationId });
  });
  return until;
}

// 「出る」。即座に解除する
export async function leaveTenant(db: Db, actorUserId: string, sessionId: string, associationId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ enteredAssociationId: null, enteredUntil: null })
      .where(eq(sessions.sessionHash, hashSessionId(sessionId)));
    await logAdminAccess(tx, { userId: actorUserId, associationId, action: "leave_tenant", targetId: associationId });
  });
}
