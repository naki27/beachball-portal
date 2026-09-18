import { forbidden } from "next/navigation";
import { cache } from "react";
import type { AccessResult, ForbiddenReason } from "@/lib/authz";

export type ForbiddenInfo = { reason: ForbiddenReason; who?: string };

// 同じリクエストの中で forbidden.tsx に理由を渡す（React の cache はリクエスト単位）
const holder = cache((): { info: ForbiddenInfo | null } => ({ info: null }));

export function readForbiddenInfo(): ForbiddenInfo | null {
  return holder().info;
}

// 画面で権限がないとき。リダイレクトせず 403 のページを返す（§3.1）。Route Handler では使わない（Response を返す）
export function denyPage(info: ForbiddenInfo): never {
  holder().info = info;
  forbidden();
}

// checkAccess の結果が ok でなければ 403 のページ
export function assertAccessOrDeny(result: AccessResult): void {
  if (!result.ok) denyPage({ reason: result.reason, who: result.who });
}
