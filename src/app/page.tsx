import { SITE_NAME } from "@/lib/site";

// 仮のトップページ（入口の中身は A-13 で作る）
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{SITE_NAME}</h1>
      <p className="leading-relaxed">
        準備中です。大会の申し込みは、協会のページからできるようになります。
      </p>
    </main>
  );
}
