import { DelayedSkeleton } from "./loading";
import { PageMain, type PageWidth } from "./layout";

// ページの読み込み中に出す骨組み（設計書 §4.5「読み込みが 1 秒を超えた」「3 秒を超えた」）
// 1 秒未満で終わる読み込みでは何も出さない（画面がちらつかない）。3 秒を超えたら「少々お待ちください」
// 各区画の loading.tsx から使う
export function PageSkeleton({ width = "narrow", lines = 6 }: { width?: PageWidth; lines?: number }) {
  return (
    <PageMain width={width}>
      <DelayedSkeleton lines={lines} />
    </PageMain>
  );
}
