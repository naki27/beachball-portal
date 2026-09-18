import type { Db } from "@/db/client";
import { adminAccessLogs } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 管理者の重要操作・運営管理者のテナント切り替えの記録（設計書 §5.14・§9.4・付録 A）。個人情報は入れない
// app_user は insert しか持たない（読むのは管理画面用の関数経由）ので、id はここで作り RETURNING を使わない
export type AdminAccessAction =
  | "enter_tenant"
  | "leave_tenant"
  | "physical_delete"
  | "invite_admin"
  | "accept_admin"
  | "revoke_admin"
  | "merge_members"
  | "import_memberships"
  | "change_slug"
  | "create_association";

export async function logAdminAccess(
  tx: Tx | Db,
  input: { userId: string; associationId: string | null; action: AdminAccessAction; targetId?: string | null },
): Promise<string> {
  const id = crypto.randomUUID();
  await tx.insert(adminAccessLogs).values({
    id,
    userId: input.userId,
    associationId: input.associationId,
    action: input.action,
    targetId: input.targetId ?? null,
  });
  return id;
}
