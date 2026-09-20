# 0019 大会・申込・会員の表の細部（列を指定した SET NULL ほか）

## 背景

B-01 で大会（`tournaments`・`tournament_categories`）・申込（`entries`・`entry_players`・`entry_audits`）・会員（`memberships`・`membership_periods`・`membership_declarations`）と `export_logs` を作った。付録 A の DDL をそのまま写すだけでは決まらない点が 3 つあった。

1. 付録 A の `on delete set null (列名)`（PostgreSQL 15 以降の、複合外部キーのうち 1 列だけを NULL にする書き方）は drizzle の schema では表せない
2. 運営管理者の横断画面の「受付中の大会」（`platform_association_stats()`）を、どの条件で数えるか
3. `entry_audits`・`export_logs` に update / delete の権限を与えるか

## 決定

1. **schema は複合外部キーのまま（`on delete` なし）にし、生成したマイグレーションの 3 行を手で `ON DELETE SET NULL (列名)` に直す**。対象は `entry_players_member_fk`（`member_id`）・`memberships_team_fk`（`team_id`）・`contact_messages_entry_fk`（`entry_id`）。直した行にはその旨のコメントを置き、テスト（`tests/db/tournaments-schema.test.ts`）で実際の動き（親を物理削除すると当該列だけ NULL になり、行は残る）を確かめる
2. **`status = 'open'` かつ削除済みでない大会の数**を数える。申込期間の中かどうかは見ない（期間の判定は `deadline.ts`・B-02。この数字は「運営が受付状態にしている大会」の意味）
3. **`select, insert` だけにする**（`deletion_logs` と同じ）。保存期間を過ぎた行の物理削除を日次ジョブに足すときに、`app_job` へ delete を足す

## 理由

- 1: drizzle の `foreignKey().onDelete()` は列を指定した SET NULL を出せない。schema 側で `onDelete("set null")` と書くと、複合キー全体（NOT NULL の `association_id` を含む）を NULL にしようとして当たらない。生成物を 1 行直すほうが、生成を諦めて表ごと手書きするより差分が小さい。スナップショットには「no action」として残るが、`db:generate` は schema とスナップショットを比べるだけなので、次の生成で差分として出戻ることはない（この表を作り直すときは同じ手直しが必要）
- 2: §5.14 の画面は「いま受け付けている大会がいくつあるか」を運営管理者に見せるためのもの。締切の判定を SQL に二重に書くと `deadline.ts` と食い違う
- 3: 申込の変更履歴と出力の記録は、あとから書き換えられては意味がない（§5.16・§12）

## 却下した代替案

- 単一列の外部キー（`entry_players.member_id` → `members(id)`）にして `set null` を素直に使う: 別の協会の人物を指せてしまい、「すべての協会データのクエリに `association_id` を入れる」という機構での防止が崩れる
- 申込の物理削除で問い合わせ・メールの記録も一緒に消す: 問い合わせは協会と本人のやりとりの記録で、申込を消しても残す必要がある（§5.10）
- `tournaments.team_size_min >= 部門の court_size` を DB の制約にする: 表をまたぐので CHECK では書けない。付録 A どおり保存時にアプリで検証する（B-04）
