"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import {
  formatRetryAt,
  rememberLogin,
  requestCode,
  safeNext,
  useIsClient,
  useRememberedEmail,
  useRememberedNext,
} from "@/lib/auth/login-client";

// 受信設定のページ（各社の案内。URL は運用手順書で見直す）
const CARRIERS = [
  { name: "docomo", href: "https://www.docomo.ne.jp/service/mail/" },
  { name: "au", href: "https://www.au.com/support/service/mobile/trouble/mail/" },
  { name: "SoftBank", href: "https://www.softbank.jp/mobile/support/mail/" },
];

export function HelpForm({ senderDomain }: { senderDomain: string }) {
  const router = useRouter();
  const hydrated = useIsClient();
  const remembered = useRememberedEmail();
  const rememberedNext = useRememberedNext();
  const [edited, setEdited] = useState<string | null>(null);
  // 入力したアドレスを編集できる欄に入れて表示する（§11.3）。直すまでは覚えているアドレス
  const value = edited ?? remembered ?? "";
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; title: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyDomain() {
    try {
      await navigator.clipboard.writeText(senderDomain);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFieldError(null);
    setNotice(null);
    const next = safeNext(rememberedNext);
    setPending(true);
    const outcome = await requestCode(value.trim(), next);
    setPending(false);
    if (outcome.kind === "sent") {
      rememberLogin(value.trim(), next, outcome.resendAfterSeconds);
      router.push(next ? `/login/code?next=${encodeURIComponent(next)}` : "/login/code");
    } else if (outcome.kind === "invalid") {
      setFieldError(outcome.message);
    } else if (outcome.kind === "rate_limited") {
      setNotice({ kind: "info", title: `${formatRetryAt(outcome.retryAt)}まで送れません。迷惑メールフォルダも見てください` });
    } else {
      setNotice({ kind: "error", title: "送信できませんでした" });
    }
  }

  return (
    <ol className="flex list-decimal flex-col gap-6 pl-6 leading-relaxed">
      <li>迷惑メールフォルダを見てください。</li>
      <li>
        <p>
          受信の設定で <span className="font-semibold">{senderDomain}</span> からのメールを受け取れるようにしてください。
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={copyDomain}>
            {copied ? "コピーしました" : "このドメインをコピー"}
          </Button>
          {CARRIERS.map((c) => (
            <a
              key={c.name}
              href={c.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center underline underline-offset-2"
            >
              {c.name} の設定
            </a>
          ))}
        </div>
      </li>
      <li>
        <p>メールアドレスの打ち間違いがないか確かめてください。直したら、下のボタンで送り直せます。</p>
        <form onSubmit={onSubmit} noValidate data-hydrated={hydrated || undefined} className="mt-3 flex flex-col gap-4">
          {notice ? <Message kind={notice.kind} title={notice.title} /> : null}
          <TextField
            id="help-email"
            label="メールアドレス"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={value}
            onChange={(e) => setEdited(e.target.value)}
            error={fieldError}
          />
          <Button type="submit" pending={pending} fullWidth>
            このアドレスに送り直す
          </Button>
        </form>
      </li>
      <li>
        それでも届かないときは、
        <Link href="/contact" className="underline underline-offset-2">
          問い合わせフォーム
        </Link>
        からご連絡ください。
      </li>
    </ol>
  );
}
