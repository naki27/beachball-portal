import type { Metadata } from "next";
import { HelpForm } from "./help-form";
import { PageMain } from "@/components/ui/layout";

export const metadata: Metadata = { title: "メールが届かないとき" };

// メールが届かないときの案内（設計書 §11.3）。電話番号は載せない
export default function LoginHelpPage() {
  const senderDomain = (process.env.MAIL_FROM ?? "noreply@localhost").split("@")[1] ?? "";
  return (
    <PageMain>
      <h1 className="text-2xl font-bold">メールが届かないとき</h1>
      <HelpForm senderDomain={senderDomain} />
    </PageMain>
  );
}
