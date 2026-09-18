import type { Metadata } from "next";
import { resolveAssociation } from "@/lib/resolve-association";
import { slugFromUrl } from "@/lib/slug";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "ログイン" };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

// ログイン（設計書 §5.1・§5.2）。アカウント作成と分けない。入力はメールアドレスだけ
// 協会のページから来た場合（next の先頭が協会のスラッグ）は協会名を出す
export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const slug = nextPath ? slugFromUrl(nextPath) : null;
  const resolution = slug ? await resolveAssociation(slug) : null;
  const associationName = resolution && resolution.kind !== "not_found" ? resolution.association.name : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">ログイン</h1>
      {associationName ? <p className="leading-relaxed">ログインすると、{associationName}のページに戻ります。</p> : null}
      <p className="leading-relaxed">
        メールアドレスを入力してください。確認番号（6 けたの数字）をメールで送ります。はじめての方も同じです。
      </p>
      <LoginForm next={nextPath} />
    </main>
  );
}
