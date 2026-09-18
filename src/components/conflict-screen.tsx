import type { ReactNode } from "react";
import { ErrorScreen } from "@/components/error-screen";

// 409（締切後・定員など、業務上の条件で受け付けられない）。理由と問い合わせの導線を出す（§4.2 #25・§4.4）
// 「権限がありません」とは書かない。ページの中に埋め込んで使う（HTTP の状態コードは API の応答だけに付ける・docs/adr/0003）
export function ConflictScreen({
  title = "受付は終了しました",
  contactHref,
  children,
}: {
  title?: string;
  // 問い合わせフォームの URL（A-22）。なければ文言だけ
  contactHref?: string;
  children?: ReactNode;
}) {
  return (
    <ErrorScreen title={title} action={contactHref ? { href: contactHref, label: "問い合わせフォームへ" } : undefined}>
      {children ?? <p>変更は問い合わせフォームからご連絡ください。</p>}
    </ErrorScreen>
  );
}
