"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { DelayedSkeleton } from "@/components/ui/loading";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { UndoBar } from "@/components/ui/undo-bar";
import { useDraft } from "@/hooks/use-draft";
import { draftKey } from "@/lib/draft";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border pb-1 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

const DEMO_DRAFT_KEY = draftKey({ associationId: "dev", screen: "ui-gallery" });

export function UiGallery() {
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [memo, setMemo] = useState("");
  const draft = useDraft<string>(DEMO_DRAFT_KEY, { onRestore: setMemo });

  const emailError = showErrors && !email.includes("@") ? "メールアドレスの形で入力してください" : null;
  const nameError = showErrors && name.trim() === "" ? "氏名を入力してください" : null;
  const errors = [
    emailError ? { id: "demo-email", label: "メールアドレス", message: emailError } : null,
    nameError ? { id: "demo-name", label: "氏名", message: nameError } : null,
  ].filter((e): e is NonNullable<typeof e> => e !== null);

  return (
    <div className="flex flex-col gap-10">
      <Section title="ボタン">
        <div className="flex flex-col gap-3">
          <Button
            onClick={() => {
              setPending(true);
              setTimeout(() => setPending(false), 2000);
            }}
            pending={pending}
          >
            申し込む（押すと 2 秒だけ送信中になる）
          </Button>
          <Button variant="secondary">戻る</Button>
          <Button variant="danger">申し込みを取り消す</Button>
          <Button disabled>押せないボタン</Button>
        </div>
      </Section>

      <Section title="入力欄と誤りの表示">
        <ErrorSummary errors={errors} />
        <TextField
          id="demo-email"
          label="メールアドレス"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="ログインのための確認番号をこのアドレスに送ります"
          error={emailError}
        />
        <TextField
          id="demo-name"
          label="氏名"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          hint="全角の英数字は半角に、半角カタカナは全角に自動で変換されます。表示は入力されたとおりに残ります"
          error={nameError}
        />
        <TextField id="demo-age" label="年（数字だけ）" inputMode="numeric" pattern="[0-9]*" placeholder="40" />
        <Button variant="secondary" onClick={() => setShowErrors(true)}>
          入力を確かめる
        </Button>
      </Section>

      <Section title="メッセージ（自動で消えない）">
        <Message kind="success" title="保存しました" />
        <Message kind="error" title="送信できませんでした">
          時間をおいてから、もう一度お試しください。
        </Message>
        <Message kind="info" title="9月30日（水）まで　あと5日" />
      </Section>

      <Section title="外した・削除した（元に戻す）">
        {removed ? (
          <UndoBar message="外しました" onUndo={() => setRemoved(false)} />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
            <span>山田 太郎</span>
            <Button variant="secondary" onClick={() => setRemoved(true)}>
              選手一覧から外す
            </Button>
          </div>
        )}
      </Section>

      <Section title="読み込みの骨組み（1 秒で骨組み、3 秒で「少々お待ちください」）">
        {loading ? (
          <DelayedSkeleton />
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 6000);
            }}
          >
            6 秒の読み込みを再現する
          </Button>
        )}
      </Section>

      <Section title="電波が切れた帯（ページ上部）">
        <div className="flex flex-col gap-3">
          <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("offline"))}>
            電波が切れたことにする
          </Button>
          <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("online"))}>
            つながったことにする
          </Button>
        </div>
      </Section>

      <Section title="入力の一時保存（localStorage・7 日）">
        <label htmlFor="demo-memo" className="font-semibold">
          メモ（打つと 0.5 秒後に保存。ページを開き直すと戻る）
        </label>
        <textarea
          id="demo-memo"
          className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-base"
          value={memo}
          onChange={(e) => {
            setMemo(e.target.value);
            draft.save(e.target.value);
          }}
        />
        <p className="text-sm text-muted" role="status">
          {draft.savedAt
            ? `保存しました（${draft.savedAt.toLocaleTimeString("ja-JP")}）`
            : draft.restored !== null
              ? "前回の入力を戻しました"
              : "まだ保存していません"}
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            draft.clear();
            setMemo("");
          }}
        >
          一時保存を消す（送信の完了・ログアウトのとき）
        </Button>
      </Section>
    </div>
  );
}
