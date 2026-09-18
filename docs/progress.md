# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-15 名寄せ
- 次のタスク: A-16 生年月日の入力部品（和暦）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-15（2026-09-18）
- やったこと: `src/lib/matching.ts`（純粋な判定 `decideMatch(keys, choice, candidates)`・「ルールと記録の対応」の表 `MATCH_OUTCOMES`・`matchKeysOf`（正規化は normalize.ts）・`findMatch`（候補を引いて判定）・`resolveMember`（判定どおりに結びつける／新しく作り、要確認は新しい側だけ。既存の人物は変えない））。`listMatchCandidates`（`src/lib/repo/members.ts`。同じ協会・active / needs_review・未削除で、氏名一致、またはふりがな（空でないとき）＋生年月日一致）。`createMember` に `status`。ADR 0009（ルールの順・別名は使わない）
- 動作確認: lint / typecheck / test（TZ 2 回・191 本。§8.3 のルール 0〜7 と表・探索対象・「ふりがなが空同士ならルール 5 を使わない」）
- 次への申し送り・既知の課題:
  - 選手一覧への追加（A-17）は `resolveMember(tx, associationId, person)`（choice は none）。申込の選手枠（B 系）は picked / declined を渡す。picked の人物を選んでよいか（代表者を務めるチームの選手か）は呼ぶ側で確かめる
  - `entry_players.match_type` は表の `matchType` をそのまま入れる。`unmatched`（人物の物理削除後）は削除の処理の側で
  - 候補の行は生年月日を含む。画面や API にそのまま返さない
- 使った枠（/usage の変化）: 未計測

### A-14（2026-09-18）
- やったこと: `/[slug]/teams/new`（チームで登録。チーム名だけで作れる・「協会員の登録をするチーム」は既定で外す・同名は 409 で警告し「別のチームとして登録する」）、`/[slug]/teams/[teamId]`（骨組み: 名前・協会員の登録・連絡先は代表者から・「チーム情報を変える」）、`…/edit`。`src/lib/teams/{team-input,teams}.ts`（`registerTeam` は作成と `team_admins`（granted_by NULL）を 1 トランザクション、`editTeam` は 404 → 403 → 400）、`src/lib/repo/roles.ts`（`getMembership` の中身を切り出し）、`src/lib/page/require-team.ts`、`src/lib/api/tenant.ts`（`/api/[slug]/…` の入口）、`src/lib/ids.ts`。`ACTIONS.editTeam`。API: `POST /api/[slug]/teams`、`PATCH /api/[slug]/teams/[teamId]`。マイページの協会の枠に代表者を務めるチームと「チームを登録する」。ADR 0008
- 動作確認: lint / typecheck / test（TZ 2 回・162 本。代表者でない人の編集は 403、別の協会のチーム ID は 404）、E2E 42 本（未ログインで 403 → ログイン → チーム名だけで登録 → マイページ → 同名の警告 → 別の協会のチームは 404）
- 次への申し送り・既知の課題:
  - `next.config.ts` の `onDemandEntries`（開発時だけ・1 時間）でページを捨てないようにした。既定のままだと E2E の途中で再コンパイルが走ってログインなどが時間切れになっていた。global-setup も API を含めて温める
  - ログアウトのボタンは読み込み（ハイドレーション）が済むまで押せない（メニューは `<details>` で先に開けるため）
  - 活動地域は列がないので入れていない（ADR 0008）。チームの無効化・削除、代表者の委譲は後のタスク
  - dev サーバーが重くなったら（RSS 3GB 超・待機中も CPU 90%）コンテナの中で `pnpm dev:poll` を立て直す
- 使った枠（/usage の変化）: 未計測

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
