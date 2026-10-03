import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UiGallery } from "./ui-gallery";
import { PageMain } from "@/components/ui/layout";

export const metadata: Metadata = { title: "部品の一覧（開発用）" };

// 共通部品を触って確かめるページ。開発のときだけ開ける（本番は 404）
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageMain gap="xl">
      <h1 className="text-2xl font-bold">部品の一覧（開発用）</h1>
      <UiGallery />
    </PageMain>
  );
}
