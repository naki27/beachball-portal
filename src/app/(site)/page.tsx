import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader, PageMain, Section } from "@/components/ui/layout";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { loadMyAssociations } from "@/lib/page/my-associations";
import { SITE_NAME } from "@/lib/site";

// 入口（設計書 §5.14「協会をまたぐ画面」）。役割を持つ協会の一覧。1 つだけでもリダイレクトしない。未ログインは 403
// 協会の案内（大会の申し込みなど）は協会のページ（/[スラッグ]）にある
export default async function Home() {
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const associations = await loadMyAssociations(principal);

  return (
    <PageMain width="wide" gap="lg">
      <PageHeader
        tone="hero"
        title={SITE_NAME}
        lead="大会の申し込みと、チーム・選手の登録ができます。"
        actions={
          <>
            <Link href="/mypage" className={buttonClass("secondary")}>
              マイページ
            </Link>
            {principal.isPlatformAdmin ? (
              <Link href="/platform" className={buttonClass("secondary")}>
                運営管理
              </Link>
            ) : null}
          </>
        }
      />
      {associations.length === 0 ? (
        <EmptyState
          title="まだどの協会にも登録していません"
          description="協会から案内されたページを開いて、チームや選手を登録してください。"
        />
      ) : (
        <Section id="my-associations" title="あなたが関わっている協会">
          <ul className="bb-stagger grid gap-3 md:grid-cols-2">
            {associations.map((a) => (
              <li key={a.id}>
                <Link href={`/${a.slug}`} className="block h-full no-underline">
                  <Card interactive className="flex h-full flex-col gap-1">
                    <span className="text-lg font-bold">{a.name}</span>
                    {a.roles.length > 0 ? <span className="text-sm text-muted">{a.roles.join("・")}</span> : null}
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </PageMain>
  );
}
