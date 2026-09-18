import { forbidden } from "next/navigation";
import { type AccessResult, ROLE_LABEL } from "@/lib/authz";

// 画面で権限がないとき（設計書 §3.1）。リダイレクトせず 403 のページ（forbidden.tsx）を返す
// forbidden.tsx には値を渡せない（ページの描画とは別に描画される）ので、文言は forbidden.tsx が自分で決める:
//   - 未ログイン / セッション切れ / 権限なし は getPrincipal() の sessionState から
//   - 「誰なら見られるか」は URL から（下の表）。画面を足すときはここに規則を足す（§3.2）
// Route Handler では使わない（Response を返す）

export function denyPage(): never {
  forbidden();
}

export function assertAccessOrDeny(result: AccessResult): void {
  if (!result.ok) forbidden();
}

// URL の規則 → その画面を見られる最も低いロールの呼び名（§3.2・§4.4）。上から順に最初に当たったもの
const WHO_BY_PATH: ReadonlyArray<[RegExp, string]> = [
  [/^\/platform(\/|$)/, ROLE_LABEL.platform_admin],
  [/^\/[^/]+\/admin(\/|$)/, ROLE_LABEL.association_admin],
  [/^\/[^/]+\/teams\/new$/, ROLE_LABEL.registered],
  [/^\/[^/]+\/teams\/[^/]+\/(edit|roster|entries|admins|invitations|membership|export)(\/|$)/, ROLE_LABEL.team_admin],
  [/^\/[^/]+\/teams\/[^/]+(\/|$)/, ROLE_LABEL.player],
  [/^\/(mypage|invitations|account)(\/|$)/, ROLE_LABEL.registered],
  [/^\/$/, ROLE_LABEL.registered],
];

export function whoCanSee(pathname: string): string {
  const path = pathname.split("?")[0];
  for (const [pattern, who] of WHO_BY_PATH) {
    if (pattern.test(path)) return who;
  }
  return "権限のある人";
}
