# 0006 運営管理者の横断画面で読む関数

## 背景

設計書 §5.14「運営管理者」は、横断画面（`/platform`）の件数を `SECURITY DEFINER` 関数 `platform_association_stats()`（付録 A: `association_id, teams, members, open_tournaments`）から取り、テナント管理者のメールアドレスと表示名は運営管理者に見せてよい、としている。§4.2 #24 は一覧に「テナント管理者の人数」を出す。A-11 で次の決めが要った。

1. 「テナント管理者の人数」「返事待ちの招待の数」をどこから取るか
2. テナント管理者の一覧（招待・解除に使う）をどう読むか（`association_admins` は RLS の下）

## 決定

1. **`platform_association_stats()` に `admins bigint`・`pending_admin_invitations bigint` の 2 列を足す**（0006 で作り直し）。付録 A のスケッチより列が増えるが、返すのは件数だけという性格は変えない
2. **`platform_association_admins()`（`SECURITY DEFINER`。所有者 app_definer）を足す**。運営管理者（`app.user_id` が `platform_admins` にいる）のときだけ、全協会の管理者の `association_id, user_id, email, display_name, granted_at` を返す。選手やチームの情報は返さない
3. 運営管理者がテナントの表に**書く**とき（作成時のプリセット・招待の行、スラッグの履歴）は、`setTenant(tx, associationId, { userId })` でその協会に固定してから書く。RLS は「協会が一致するか」だけを見るので、運営管理者の操作もこの形で通る（入っていなくてもよい。読むときは「入る」が要る）

## 理由

- 1: 別の関数に分けるより 1 回で取れるほうが単純。件数だけなので個人情報の扱いは変わらない
- 2: §5.14 が「テナント管理者のメールアドレスと表示名は表示してよい」と明確化している。RLS を外したロールでの横断クエリは使わない決まりなので、関数にする
- 3: 作成・スラッグ変更は「入って」から行う操作ではない（§5.14 の運営管理者だけができることの一覧）。書く先の協会を明示するだけでよい

## 却下した代替案

- 運営管理者に `association_admins` を読む権限（BYPASSRLS）を付ける: 設計書が禁じている
- 招待の数は A-12 で別の関数にする: 一覧に出す値なので、stats と分けると 2 回読むことになる
