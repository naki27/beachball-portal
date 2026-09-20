import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { contactMessages, platformContactMessages } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { isUuid } from "@/lib/ids";

// 問い合わせの管理（設計書 §5.10）。協会宛ては /[スラッグ]/admin/contacts、サイトの運営者宛ては /platform/contacts
// 削除済み（deleted_at）は既定で出さない。対応済みにする・未対応に戻すだけで、本文は変えない

export type ContactStatus = "new" | "done";

export type ContactListRow = {
  id: string;
  subjectType: string;
  senderName: string;
  senderEmail: string;
  body: string;
  status: ContactStatus;
  createdAt: Date;
};

export async function listAssociationContacts(
  db: Db,
  associationId: string,
  filter: { status?: ContactStatus } = {},
): Promise<ContactListRow[]> {
  return withTenantOn(db, associationId, async (tx) =>
    tx
      .select({
        id: contactMessages.id,
        subjectType: contactMessages.subjectType,
        senderName: contactMessages.senderName,
        senderEmail: contactMessages.senderEmail,
        body: contactMessages.body,
        status: contactMessages.status,
        createdAt: contactMessages.createdAt,
      })
      .from(contactMessages)
      .where(
        and(
          eq(contactMessages.associationId, associationId),
          isNull(contactMessages.deletedAt),
          filter.status ? eq(contactMessages.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(contactMessages.createdAt)),
  );
}

export async function setAssociationContactStatus(
  db: Db,
  associationId: string,
  messageId: string,
  status: ContactStatus,
): Promise<boolean> {
  if (!isUuid(messageId)) return false;
  return withTenantOn(db, associationId, async (tx) => {
    const result = await tx
      .update(contactMessages)
      .set({ status })
      .where(
        and(
          eq(contactMessages.id, messageId),
          eq(contactMessages.associationId, associationId),
          isNull(contactMessages.deletedAt),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  });
}

export async function listPlatformContacts(db: Db, filter: { status?: ContactStatus } = {}): Promise<ContactListRow[]> {
  return db
    .select({
      id: platformContactMessages.id,
      subjectType: platformContactMessages.subjectType,
      senderName: platformContactMessages.senderName,
      senderEmail: platformContactMessages.senderEmail,
      body: platformContactMessages.body,
      status: platformContactMessages.status,
      createdAt: platformContactMessages.createdAt,
    })
    .from(platformContactMessages)
    .where(filter.status ? eq(platformContactMessages.status, filter.status) : undefined)
    .orderBy(desc(platformContactMessages.createdAt));
}

export async function setPlatformContactStatus(db: Db, messageId: string, status: ContactStatus): Promise<boolean> {
  if (!isUuid(messageId)) return false;
  const result = await db
    .update(platformContactMessages)
    .set({ status })
    .where(eq(platformContactMessages.id, messageId));
  return (result.rowCount ?? 0) > 0;
}
