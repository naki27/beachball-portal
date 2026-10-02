# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: D-05 協会員区分の表示と 1d の仕上げ。**Phase 1c・1d は完了（P0 の実装は一巡）**。作業ブランチは `feature/cd`（`main` は B-18 のまま）。2026-09-24 に L-02〜B-18 の申し送りを全部コードと突き合わせ、解消済みを消して残りを下にまとめた（各タスクの「やったこと」は docs/progress-archive.md）
- 次のタスク: X-01〜X-05（本番の準備。人の準備は `docs/deploy-prep.md` のチェックリスト。環境ができてから `docs/p0-tasks.md` §6 に書き足す）。`feature/cd` を `main` に取り込む判断は人が行う
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 直近のタスクの申し送り
### D-05（2026-09-25）
- やったこと: 申込一覧と CSV の協会員区分を `membershipDisplays` / `membershipDisplayLabel` に差し替え（開催日の年度・受付も取り込みもない年度は空欄・「更新の受付中（昨年度は協会員）」。`buildEntriesCsv` に `now`）。選手一覧に「今年度（◯年度）: …」（`getRoster` の `membership`・代表者以上と本人だけ・`viewMembershipStatus`）。「協会員だけを表示」は既存のテスト（`entry-form`・`member-suggest`）で承認済みだけに絞れることを確認。E2E `tests/e2e/membership.spec.ts`（受付開始 → 案内 → 更新の受付中 → 申告 → 承認 → 協会員（年度））。README・`docs/ops.md` に 1c・1d の節
- 次への申し送り: 申込一覧の区分の言い方が「協会員／非会員」から §4.4 の言い方（「協会員（2026年度）」「協会員ではない」など）に変わった。初年度の取り込み・依頼と督促の一斉送信・名簿出力は P1
### D-04（2026-09-25）
- やったこと: `/admin/memberships/[year]`（未申告の一覧＝対象チームだけ・申告済みの内訳・「運営の確認待ちの N 人をまとめて承認する」・追加の申告をチームごとに承認・代理の申告と修正は各チームの申告の画面へ）。`src/lib/admin/membership-approval.ts`（`getMembershipYearForAdmin`・`approveMemberships`: applied → approved、チームごとに `membership_approved`）。追加の申告は `declaration.ts` の `declarationMode`（受付前 / 受付中 / 締切後〜年度末 = additional / 年度末後）。additional は増やすだけ・`source = additional`・承認を省く年度でも applied・すでに申告した人は画面でロック。年度末は `membership.ts` の `fiscalYearEndOf`。API `POST /api/[slug]/admin/memberships/[year]/approve`
- 次への申し送り: 督促メール・依頼メールの一斉送信は P1。`mail.test.ts` の「雛形のない種別」は `team_admin_granted` に変えた（membership_* に雛形ができたため）。チーム管理の「今年度: 会員／未申告／非会員」・申込一覧と CSV の区分・申告の E2E は D-05
### D-03（2026-09-25）
- やったこと: `/teams/[id]/membership`（昨年度の会員に初期チェック・「N人中M人を2027年度も登録します」・「昨年度の会員」ラベル・状態の言い方・その場で選手を追加（`PlayerForm` を `<details>` に）・締切後は運営への案内）。`src/lib/memberships/declaration.ts`（`getDeclarationView`・`submitDeclaration`: 入れた人は applied（承認を省く年度は approved）、外した人は当年度が applied/approved なら declined・行がなく昨年度の会員なら declined を作る、変えていない人はそのまま。締切後は代表者 409・テナント管理者は代理で可。控えは `membership_applied`）。API `POST /api/[slug]/teams/[id]/membership`（`declareMembership`）
- 次への申し送り: 追加の申告（年度の途中・`source = additional`・承認必須）と未申告一覧・一括承認は D-04。チーム管理の画面の「今年度: 会員／未申告／非会員」と申込一覧の区分は D-05。DB テストの年度は 2091（受付）・2092（申告）・2991（判定）で分けている
### D-01（2026-09-25）
- やったこと: `src/lib/membership.ts`（`fiscalYearOf` は `date.ts` の `fiscalYear` を呼ぶだけ・`isMember`・`membershipDisplay(s)`・`membershipDisplayLabel`。判定の材料を渡す純粋関数 `membershipDisplayOf` を中心に）、`repo/memberships.ts` に受付（`findMembershipPeriod`）・取り込みの有無・人物 × 年度の行の読み出し。単体・DB テストは付録 F の必須ケース
- 次への申し送り: `admin/entries.ts` の協会員／非会員の列はまだ `membershipDisplays` を通していない（D-05 で差し替え）。受付の「開始日」は判定に使わない（付録 F どおり締切だけ）
## 残っている申し送り（2026-09-24 に見直し）
### あとのタスクで片づくもの
- 協会員区分は「協会員／非会員」だけ（`memberships` の年度データがなければ空欄）。「更新の受付中」などは D-05

### 本番の前に（X 系・運用）
- R2（`src/lib/storage/r2.ts`）は**本物の R2 で未確認**（Content-Disposition・Cache-Control を含む）。§11.2 の送信数 8 割の警告も未実装 → X-01。バックアップの鍵はローカルだと `.local-storage/backup-test-key.json`。配信は ADR 0027（Workers。D-4 は「任せられない」。Workers は X-05）。人の準備（deploy-prep.md）は 2026-10-02 に完了。控えた値は `docs/deploy-values.local.md`（Git に入れない）。3 バケットに 1 組のキーなのでバックアップ用のキーを X-03 で分ける
- 日次ジョブの ① DB バックアップ・⑦ 最小インスタンス数は未実装（⑥ 大会資料の後始末は C-02 で入れた）
- 保存期間: `RETENTION_DAYS`（`daily.ts`）に `entry_audits`・`export_logs` がない。足すときは `app_job` に delete の GRANT が要る（`0012` は select・insert だけ）
- E2E は CI に入れていない（L-05・A-29 で先送りしたまま。入れるか決める）
- 運営画面に「アクセス記録」（`admin_access_logs`）と `mail_logs` を読む画面がない（§5.14。RLS 外の表なので読むには SECURITY DEFINER が要る）
- 法務の【要確認】（`docs/legal/*.md` の末尾）・らくらくスマートフォンの実機・`docs/ops.md` §8 の未決事項

### 小さな未実装・気になる点（どのタスクにも割り当てていない）
- 申込ページで管理者が定員を超えるときの「定員を超えています」の確認は未実装（サーバーは管理者なら通す・`submit-entry.ts`。管理画面の申込一覧に説明文だけ）
- 問い合わせは `?entryId=` を `contact_messages.entry_id` に入れるだけ。`tournament_id` は入れず、申込の画面から `?entryId=` 付きで飛ぶ導線もない（変更画面の 409 は `/contact` だけ）
- 個人登録だけの人にも `/`・マイページで「チームの代表者」と出る（`ROLE_LABEL`。`getMembership` がチームの種類を持たない）
- `/admin/trash` は全件を 1 ページに出す。`db:studio` は app_owner でつなぐのでテナント表が 0 件に見える（中身は `postgres` でつなぐ）
- 資料のタイトルを変えても公開用の名前（URL）は変えない（共有済みの URL を壊さないため。保存時のファイル名だけ古いまま）
- ADR 0007 の表示名 30 文字は §14-13 と突き合わせていない。規約の改定で同意を取り直す（`users.terms_version`）は P1

### 作業の注意（消さない）
- E2E: **Turbopack（`pnpm dev`）を立てて、spec を 1 本ずつ `--workers=1` で流す**。`dev:poll`（webpack）だとルートの初回コンパイルに 10〜40 秒かかって待ちを超え、worker が落ちて再コンパイルになる。Turbopack は 9p でファイルの変更を拾わないので、コードを変えたら **`.next/dev` を消してから**立て直す（消さないと古いキャッシュで動的セグメント 3 つ以上のルートが 404 になった）。先に全ページ・API を一度 curl で呼ぶ（`find src/app -name page.tsx|route.ts` から URL を作る）。`tests/e2e/fixtures.ts` の `test` を使う。`[data-hydrated]` を待ってから押す。ヘッドレスは PDF をダウンロードにするので `popup` を待たない。login などの補助関数は spec ごとに写している（共通化は未着手）
- `processMailQueue` を呼ぶ DB テストは `mail.test.ts` だけ（送信待ちを取り合うため）。`purgeFromTrash` を呼ぶテストは後始末で `deletion_logs` を先に消す（実行者を指すため）
- `0011` の列を指定した `ON DELETE SET NULL` 3 か所は手で直した（drizzle は出せない・ADR 0019）。`0016` は drizzle の出力から `0014` で手で足した分を除いた。作り直すときも同じ
- 一時保存は画面を移る直前に `saveNow`。drizzle のエラー文は引数（宛先など）を含むので `sanitizeError()` か `cause.code` だけを出す。`"use client"` の部品から `node:` を使うモジュール（`publish.ts` など）を import しない
- コンテナを作り直したら `bash .devcontainer/post-create.sh`。`pkill -f` の検索語が自分のコマンドに含まれないよう変数で組み立てる。キャリアの受信設定の URL（`help-form.tsx`）は人が確かめる
- 使った枠（/usage の変化）: 未計測
