import Link from "next/link";
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{SITE_NAME}</h1>
      {associations.length === 0 ? (
        <p className="leading-relaxed">
          まだどの協会にも登録していません。協会から案内されたページを開いて、チームや選手を登録してください。
        </p>
      ) : (
        <section aria-labelledby="my-associations" className="flex flex-col gap-3">
          <h2 id="my-associations" className="text-lg font-bold">
            あなたが関わっている協会
          </h2>
          <ul className="flex flex-col gap-3">
            {associations.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/${a.slug}`}
                  className="flex min-h-12 flex-col justify-center rounded-md border border-border px-4 py-3 no-underline hover:bg-surface"
                >
                  <span className="font-semibold">{a.name}</span>
                  {a.roles.length > 0 ? <span className="text-sm text-muted">{a.roles.join("・")}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p>
        <Link href="/mypage" className="font-semibold underline underline-offset-2">
          マイページ
        </Link>
        {principal.isPlatformAdmin ? (
          <>
            {"　"}
            <Link href="/platform" className="font-semibold underline underline-offset-2">
              運営管理
            </Link>
          </>
        ) : null}
      </p>
    </main>
  );
}
