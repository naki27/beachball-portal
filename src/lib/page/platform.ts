import { forbidden } from "next/navigation";
import { getPrincipal } from "@/lib/auth/principal";
import { isPlatformAdmin, type Principal } from "@/lib/authz";

// /platform 系の画面の入口。運営管理者でなければ 403（文言は forbidden.tsx が URL から「運営管理者だけ」と出す）
export async function requirePlatformAdminPage(): Promise<Principal & { userId: string }> {
  const principal = await getPrincipal();
  if (!principal.userId || !isPlatformAdmin(principal)) forbidden();
  return { ...principal, userId: principal.userId };
}
