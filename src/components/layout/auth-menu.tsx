import Link from "next/link";
import { getPrincipal } from "@/lib/auth/principal";
import { LogoutButton } from "./logout-button";

// ヘッダの右側: 未ログインなら「ログイン」（元のページに戻れるように next を付ける）、ログイン中なら「ログアウト」
// マイページ・協会の切り替えのメニューは A-13
export async function AuthMenu({ currentPath }: { currentPath: string }) {
  const principal = await getPrincipal();
  if (principal.userId) return <LogoutButton />;
  return (
    <Link
      href={`/login?next=${encodeURIComponent(currentPath)}`}
      className="inline-flex min-h-12 items-center px-2 font-semibold underline-offset-2 hover:underline"
    >
      ログイン
    </Link>
  );
}
