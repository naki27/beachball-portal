import { PageSkeleton } from "@/components/ui/page-skeleton";

// 管理画面の読み込み中（§4.5）。1 秒を超えたら骨組み、3 秒を超えたら「少々お待ちください」
// 協会の管理者かの検査は layout（この骨組みの外側）で行うので、403 はそのまま 403 で返る（ADR 0029）
export default function Loading() {
  return <PageSkeleton width="full" lines={8} />;
}
