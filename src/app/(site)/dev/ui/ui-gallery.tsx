"use client";

import { type ReactNode, useState } from "react";
import { type BirthDateValue, BirthDateField } from "@/components/ui/birth-date-field";
import { Button } from "@/components/ui/button";
import { Celebrate } from "@/components/ui/celebrate";
import { EnvelopeIcon } from "@/components/ui/envelope-icon";
import { RefereeBadge } from "@/components/teams/referee-badge";
import { ActionBar, Badge, Card, EmptyState, PageHeader, Toolbar } from "@/components/ui/layout";
import { ErrorSummary } from "@/components/ui/error-summary";
import { DelayedSkeleton } from "@/components/ui/loading";
import { Message } from "@/components/ui/message";
import { TextField } from "@/components/ui/text-field";
import { UndoBar } from "@/components/ui/undo-bar";
import { useDraft } from "@/hooks/use-draft";
import { useHydrated } from "@/hooks/use-hydrated";
import { parsePlainDate } from "@/lib/date";
import { draftKey } from "@/lib/draft";
import { formatBirthDateLong } from "@/lib/wareki";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="border-b border-border pb-1 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

const SCALE = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

const CHOICES = ["山田 太郎", "鈴木 花子"] as const;
const ROLES = [
  "primary",
  "primary-strong",
  "brand",
  "accent",
  "surface",
  "muted",
  "border-strong",
  "success",
  "warning",
  "danger",
] as const;

const DEMO_DRAFT_KEY = draftKey({ associationId: "dev", screen: "ui-gallery" });

export function UiGallery() {
  const hydrated = useHydrated(); // E2E がハイドレーション後に押すための印
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [memo, setMemo] = useState("");
  const [envelopeKey, setEnvelopeKey] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const draft = useDraft<string>(DEMO_DRAFT_KEY, { onRestore: setMemo });
  const [birth, setBirth] = useState<BirthDateValue>({ date: null, ready: false });
  const birthDate = birth.date ? parsePlainDate(birth.date) : null;

  const emailError = showErrors && !email.includes("@") ? "メールアドレスの形で入力してください" : null;
  const nameError = showErrors && name.trim() === "" ? "氏名を入力してください" : null;
  const errors = [
    emailError ? { id: "demo-email", label: "メールアドレス", message: emailError } : null,
    nameError ? { id: "demo-name", label: "氏名", message: nameError } : null,
  ].filter((e): e is NonNullable<typeof e> => e !== null);

  return (
    <div className="flex flex-col gap-10" data-hydrated={hydrated || undefined}>
      <Section title="色（tokens.css）">
        <p className="text-sm text-muted">
          ベース #ffffff・メイン #42B036（--brand-500）・アクセントはティール。文字と塗りつぶしのボタンには 700 以上を使う。
        </p>
        <div className="grid grid-cols-5 gap-1 sm:grid-cols-10">
          {SCALE.map((step) => (
            <div key={`brand-${step}`} className="flex flex-col items-center gap-1">
              <span className="h-10 w-full rounded-sm border border-border" style={{ background: `var(--brand-${step})` }} />
              <span className="text-xs text-muted">{step}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1 sm:grid-cols-10">
          {SCALE.map((step) => (
            <div key={`accent-${step}`} className="flex flex-col items-center gap-1">
              <span className="h-10 w-full rounded-sm border border-border" style={{ background: `var(--accent-${step})` }} />
              <span className="text-xs text-muted">{step}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((name) => (
            <span key={name} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-sm">
              <span className="size-4 rounded-full border border-border" style={{ background: `var(--color-${name})` }} />
              {name}
            </span>
          ))}
        </div>
      </Section>

      <Section title="ページの器（PageHeader・Card・Badge）">
        <PageHeader
          headingLevel={3}
          tone="hero"
          eyebrow="早良区ビーチボール協会"
          title="第 12 回 区民大会"
          lead="9月30日（水）まで　あと5日"
          actions={<Button variant="secondary">この大会を見る</Button>}
        />
        <Toolbar>
          <span className="text-sm font-semibold">絞り込み</span>
          <Badge tone="brand">受付中 3</Badge>
          <Badge tone="warning">まもなく締切 1</Badge>
          <Badge tone="neutral">終了 8</Badge>
        </Toolbar>
        <div className="bb-stagger grid gap-3 sm:grid-cols-2">
          <Card interactive>
            <p className="font-bold">混合の部</p>
            <p className="text-sm text-muted">男子 1 人・女子 3 人</p>
          </Card>
          <Card interactive tone="soft">
            <p className="font-bold">女子の部</p>
            <p className="text-sm text-muted">4 人〜7 人</p>
          </Card>
        </div>
        <EmptyState
          title="まだ申し込みはありません"
          description="受付が始まると、ここに表示されます。"
          action={<Button variant="secondary">大会を見る</Button>}
        />
      </Section>

      <Section title="マウスを乗せたとき・選んだとき（U-07）">
        <p className="text-sm text-muted">
          §4.5 原則 1「楽しさは動きではなく色・影・カードの浮き・マウスを乗せたときの反応で出す」。指の端末では浮かない
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card interactive>
            <p className="font-bold">interactive</p>
            <p className="text-sm text-muted">カードそのものがリンク。乗せると浮く</p>
          </Card>
          <Card hoverable>
            <p className="font-bold">hoverable</p>
            <p className="text-sm text-muted">中にリンクやボタンがある一覧の行。枠と影だけ変わる</p>
          </Card>
        </div>
        <ul className="flex flex-col gap-2">
          {CHOICES.map((choice) => (
            <li key={choice}>
              <label className="bb-choice flex min-h-14 items-center gap-3 rounded-md border border-border px-3 py-2 has-[:checked]:border-brand-300 has-[:checked]:bg-primary-soft">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={picked.includes(choice)}
                  onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, choice] : prev.filter((v) => v !== choice)))}
                />
                <span className="font-semibold">{choice}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-sm font-semibold" aria-live="polite">
          {CHOICES.length}人中{picked.length}人を選んでいます
        </p>
        <p className="text-sm text-muted">
          ページを移るときは、本文だけが 200ms でクロスフェードする（ヘッダと管理の案内は動かず、案内の印だけが移る）。
          対応していないブラウザでは、これまでどおり瞬時に入れ替わる
        </p>
      </Section>

      <Section title="審判の資格（K-01）">
        <p className="text-sm text-muted">
          級ごとに色（A=赤・B=黄・C=白）を変えるが、色だけに頼らず必ず級の文字を入れる（§4.5 原則 2）。審判Noは生年月日と同じ範囲の人にだけ出す
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <RefereeBadge grade="a" />
          <RefereeBadge grade="b" />
          <RefereeBadge grade="c" />
          <RefereeBadge grade="a" no="123456" />
        </div>
      </Section>

      <Section title="節目の演出（申込・申告の完了だけ）">
        <p className="text-sm text-muted">
          ADR 0028。1 回だけで止まる。OS の「視差効果を減らす」が ON なら紙吹雪は出ず、チェックと文字だけが残る。
        </p>
        <Celebrate title="申し込みが完了しました">
          <p>控えのメールをお送りしました。</p>
        </Celebrate>
      </Section>

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
          <Button variant="accent">資料を見る</Button>
          <Button variant="danger">申し込みを取り消す</Button>
          <Button variant="ghost">あとで</Button>
          <Button disabled>押せないボタン</Button>
          <Button size="sm" variant="secondary">
            小さいボタン（一覧の中で使う）
          </Button>
        </div>
        <ActionBar sticky={false}>
          <Button fullWidth>確認へ</Button>
          <Button variant="secondary" fullWidth>
            下書きを保存
          </Button>
        </ActionBar>
      </Section>

      <Section title="封筒（確認番号を送ったとき）">
        <p className="flex items-start gap-2">
          <EnvelopeIcon key={envelopeKey} className="mt-0.5 size-7 shrink-0" />
          <span>メールを送りました。届いた 6 けたの数字を入れてください。</span>
        </p>
        <Button variant="secondary" onClick={() => setEnvelopeKey((n) => n + 1)}>
          もう一度送ったことにする（封筒が 1 回動く）
        </Button>
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
          className="min-h-24 w-full rounded-md border border-border-strong px-3 py-2 text-base"
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

      <Section title="生年月日（和暦）">
        <BirthDateField id="demo-birth" onChange={setBirth} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="birth-demo">
          <dt className="text-muted">保存する値</dt>
          <dd>{birth.date ?? "（まだ）"}</dd>
          <dt className="text-muted">確認ページ</dt>
          <dd>{birthDate ? formatBirthDateLong(birthDate) : "（まだ）"}</dd>
          <dt className="text-muted">次へ</dt>
          <dd>{birth.ready ? "進める" : "進めない"}</dd>
        </dl>
      </Section>
    </div>
  );
}
