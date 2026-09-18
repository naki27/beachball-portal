import type { Metadata } from "next";
import { HelpForm } from "./help-form";

export const metadata: Metadata = { title: "メールが届かないとき" };

// メールが届かないときの案内（設計書 §11.3）。電話番号は載せない
export default function LoginHelpPage() {
  const senderDomain = (process.env.MAIL_FROM ?? "noreply@localhost").split("@")[1] ?? "";
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-bold">メールが届かないとき</h1>
      <HelpForm senderDomain={senderDomain} />
    </main>
  );
}
