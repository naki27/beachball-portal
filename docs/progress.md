# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-13 入口・マイページの骨組み・協会の切り替え
- 次のタスク: A-14 チームの作成と代表者
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-13（2026-09-18）
- やったこと: `/`（役割を持つ協会の一覧と役割。リダイレクトしない・未ログインは 403）、`/mypage`（協会ごとの枠・返事待ちの招待の件数・ログインのアドレス・表示名の変更・ログアウト）、ヘッダ右上の「メニュー」（マイページ・運営管理・協会を切り替える（2 つ以上のときだけ。運営管理者は全協会）・ログアウト）、協会のトップの骨組み（「あなたのやること」はログイン中かつ項目があるときだけ・「受付中の大会」は空の案内）。`listMyAssociations`（`my_association_ids()`）・`listAllAssociations`、`src/lib/repo/users.ts`、`src/lib/account/display-name.ts`。API: `PATCH /api/me`（表示名）、`GET /api/me/associations`。ADR 0007（メニューの形・ログアウト後の行き先・表示名 30 文字）
- 動作確認: lint / typecheck / test（TZ 2 回・145 本）、E2E 40 本（2 つの協会の管理者でログイン → `/` に両方 → メニューで切り替え → マイページで表示名を変更）
- 次への申し送り・既知の課題:
  - ログアウトはヘッダの「メニュー」の中に移した。E2E では `page.locator("header summary", { hasText: "メニュー" })` を開いてから押す。ログアウト後は協会のページならその協会のトップ、それ以外は `/login`
  - マイページの協会の枠の中身（代表者を務めるチーム）は A-14 で `src/app/(site)/mypage/page.tsx` の枠に足す。「あなたのやること」の中身は `src/app/[slug]/page.tsx` の `todos`（B-06・D 系）
  - 表示名の上限 30 文字は §14-13 を読まずに決めた（ADR 0007）。食い違えば直す
  - ファイルを直したあとの最初の E2E は、dev サーバーの再コンパイルでログインの照合が 15 秒を超えて落ちることがある。もう一度流すと通る
- 使った枠（/usage の変化）: 未計測

### A-12（2026-09-18）
- やったこと: `src/lib/platform/admin-invitations.ts`（招待: 同じアドレスに返事待ち／期限切れがあれば同じ行を再送、管理者＋返事待ちが 5 名なら 409、既に管理者なら 409。再送・取り消し・解除（解除はセッションの `entered_*` も消す）。すべて `admin_access_logs` に記録、メールは送信待ちに積む）、`src/lib/invitations/admin-accept.ts`（承諾: `my_pending_invitations()` で本人宛てを確認 → 行をロック → pending・期限内・確認済みアドレスの一致・5 名未満 → `association_admins` に `granted_by` 付きで追加 → ほかのセッションを終了。拒否: rejected にして招待した運営管理者にメール）。テナントの作成時も招待メールを積む。メールの雛形を「送る直前に協会に固定して ID から行を読む」非同期の形にし、招待・断られた・期限切れの 3 種を追加（本文に協会名・トップの URL・ログインに使うアドレス・期限「9月17日（木）まで」・いつものブラウザで。ログイン用リンクなし）。`date.ts` に `formatDateWithWeekday`。API: `POST/DELETE /api/platform/associations/[id]/admin-invitations`、`DELETE …/admins/[userId]`、`GET /api/me/invitations`、`POST /api/me/invitations/[id]/accept|reject`。画面: `/invitations`、運営画面の「協会の管理者」の節（招待・再送・取り消し・外す）
- 動作確認: lint / typecheck / test（TZ 2 回・135 本。§5.14 の受け入れ条件 3 つ＋再送・取り消し・拒否の通知）、E2E 38 本（招待 → job:mail → Mailpit の本文 → 本人がログイン → `/invitations` で参加 → `/sawara/admin` が開く）
- 次への申し送り・既知の課題:
  - 期限切れの検出（`expired` にして招待した人に知らせる）は日次ジョブ（A-27）。雛形 `association_admin_invitation_expired` は用意済み
  - 選手・代表者の招待（`team_invitations`）への返事は A-19。`/invitations` には表示だけ出る
  - E2E の global-setup がテストの残骸（`e2e-%` のアカウント・協会・招待）を毎回消す。タイムアウトで止まったテストは finally まで進まないため
  - 運営画面の招待の欄は `getByLabel("メールアドレス", { exact: true })` で取る（連絡先の欄と重なる）
- 使った枠（/usage の変化）: 未計測

### A-11（2026-09-18）
- やったこと: `0006`: `platform_association_stats()` を作り直し（`admins`・`pending_admin_invitations` を追加）、`platform_association_admins()`（テナント管理者のメール・表示名。運営管理者のときだけ）。`src/lib/platform/associations.ts`（`createAssociationTenant`: 協会 → `setTenant` → プリセット 18 件 → 招待の行 → `admin_access_logs`、`updateAssociation`: スラッグ変更で旧スラッグを履歴へ、`enterTenant` / `leaveTenant`: `sessions.entered_*`＋記録。`PlatformError` は 400/409）、`src/lib/repo/{platform,admin-access-logs}.ts`、`src/lib/api/platform.ts`（`requirePlatformAdmin`）。API: `GET/POST /api/platform/associations`、`PATCH /api/platform/associations/[id]`、`POST/DELETE …/[id]/enter`。画面: `/platform`（一覧・件数・作成）、`/platform/associations/[id]`（件数・管理者・入る／出る・名前と URL）。`[slug]` layout に「運営管理者として ◯◯ を表示中」の帯（出る）。`jsonError` に 400・429
- 動作確認: lint / typecheck / test（TZ 2 回・129 本）、E2E 36 本（運営管理者でログイン → 協会を作る → 一覧 → スラッグ変更で 308 → 入る → 帯 → 出る）
- 次への申し送り・既知の課題:
  - 招待のメール送信・承諾・取り消しは A-12（作成時は `association_admin_invitations` の行だけ入る。作成画面の文言もそのとき直す）
  - `platform_association_stats()` の `open_tournaments` は B-01 で。「アクセス記録」「運営者宛ての問い合わせ」の画面は A-22 以降
  - E2E は並列 2（`workers: 2`）にした。4 つ以上のログインの流れが同時に走ると dev サーバーが詰まる。全体で 3 分ほど
  - ローカルで `/platform` を触るには `.env` の `SUPER_ADMIN_EMAILS` に自分のアドレスを入れて `pnpm db:seed`
- 使った枠（/usage の変化）: 未計測

### A-10（2026-09-18）
- やったこと: `0005` の `SECURITY DEFINER` 関数 `current_user_is_association_admin()`（どこかの協会の管理者か。RLS 下で読むため）。`verifyLoginCode()` を並べ替え: 一致 → users を決める → 管理者なら users の行をロック → 30 分以内に操作のある有効なセッションがあれば `admin_session_exists`（番号は使用済みにしない。API は 409）、なければ古いセッションを終了 → ここで番号を使用済みに → セッション作成。`session.ts`: 管理者は `last_seen_at` を 1 分に 1 回更新（ほかは 1 日 1 回）、`endUserSessions(db, userId, { exceptSessionId })`、`activeSessionsOf`。`pnpm dev:grant-admin <メール> <スラッグ>`
- 動作確認: lint / typecheck / test（TZ 2 回・125 本。§9.2 の受け入れ条件 4 つ＋1 分の更新＋まとめて終了）、E2E 32 本（2 つのブラウザで 409 → A のログアウト → B が同じ番号で入る）
- 次への申し送り・既知の課題:
  - E2E は dev サーバーでは 1 回のログインに 20 秒ほどかかる。テスト時間は全体 60 秒、2 台分の流れは 120 秒にした。`pnpm test` と `pnpm test:e2e` を同時に流すと詰まって落ちる
  - `dev-admin@example.com` を早良区協会の管理者にしてある（ローカルの DB だけ。`pnpm dev:grant-admin` の確認用）
- 使った枠（/usage の変化）: 未計測
