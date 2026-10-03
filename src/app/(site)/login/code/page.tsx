import type { Metadata } from "next";
import { CodeForm } from "./code-form";
import { PageMain } from "@/components/ui/layout";

export const metadata: Metadata = { title: "確認番号の入力" };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

// 確認番号の入力（設計書 §9.2・§4.5「ログイン」）。照合は A-09 の POST /api/auth/verify
export default async function LoginCodePage({ searchParams }: Props) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : null;
  return (
    <PageMain>
      <h1 className="text-2xl font-bold">確認番号を入力してください</h1>
      <CodeForm next={nextPath} />
    </PageMain>
  );
}
