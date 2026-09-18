import Link from "next/link";
import { getPrincipal } from "@/lib/auth/principal";
import { loadSwitchableAssociations } from "@/lib/page/my-associations";
import { UserMenu } from "./user-menu";

// ヘッダの右側: 未ログインなら「ログイン」（元のページに戻れるように next を付ける）、ログイン中ならメニュー
// currentSlug: 協会のページなら表示中の協会（切り替えメニューで印を付け、ログアウト後はその協会のトップへ）
export async function AuthMenu({ currentPath, currentSlug = null }: { currentPath: string; currentSlug?: string | null }) {
  const principal = await getPrincipal();
  if (principal.userId) {
    const associations = await loadSwitchableAssociations(principal);
    return (
      <UserMenu
        associations={associations.map((a) => ({ name: a.name, slug: a.slug }))}
        currentSlug={currentSlug}
        showPlatform={principal.isPlatformAdmin}
        logoutTo={currentSlug ? `/${currentSlug}` : "/login"}
      />
    );
  }
  return (
    <Link
      href={`/login?next=${encodeURIComponent(currentPath)}`}
      className="inline-flex min-h-12 items-center px-2 font-semibold underline-offset-2 hover:underline"
    >
      ログイン
    </Link>
  );
}
