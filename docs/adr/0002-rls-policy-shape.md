# 0002 RLS とロールの権限の付け方（新しい表を足すときの決まり）

## 背景

設計書 §5.14「漏れを機構で防ぐ」は、テナントに属する全表に RLS（`USING (association_id = current_setting('app.association_id', true)::uuid)`）と `FORCE ROW LEVEL SECURITY` を張り、ロールを分けることを決めている。付録 A の SQL はスケッチで、次は書かれていない。

1. トランザクションの外で `current_setting('app.association_id', true)` が `''` を返すこと（L-04 で確認。`''::uuid` はエラーになる）への対処
2. ポリシー・権限を表ごとにどう書き、新しい表を足すときに何をするか
3. `revoke execute on all functions in schema public from public` の扱い

## 決定

1. **ポリシーの式は関数 `current_association_id()` に 1 か所で書く**（`nullif(current_setting('app.association_id', true), '')::uuid`。未設定でも `''` でも NULL → 0 件）。各表のポリシーは `using (association_id = current_association_id()) with check (association_id = current_association_id())` で、名前は `<表>_tenant`
2. **テナントに属する表を足すマイグレーションには、必ず次を同じ順で書く**（雛形は `src/db/migrations/0003_rls-and-grants.sql`）
   - `alter table <表> enable row level security;` と `force row level security;`
   - `create policy <表>_tenant on <表> using (...) with check (...);`
   - `grant select, insert, update, delete on <表> to app_user, app_job;`（表の性格で絞る。記録の表は `insert` と `select` だけ）
   - `grant select on <表> to app_backup;`（`SECURITY DEFINER` 関数が読む表は `app_definer` にも）
   - テナントに属さない表は RLS なしで、`grant` だけを表ごとに決める（`platform_admins` は `select` だけ、`admin_access_logs` / `mail_logs` は app_user に `insert` だけ）
3. **`revoke execute on all functions … from public` は使わない**。拡張（citext・pg_trgm）の関数まで止まり、`app_user` が citext の比較や `similarity()` を使えなくなるため。`SECURITY DEFINER` 関数は作るたびに `revoke execute on function <関数> from public; grant execute on function <関数> to app_user;` と `alter function <関数> owner to app_definer;` を書く（`pnpm db:roles` が `grant app_definer to app_owner` をしているので所有者を変えられる）
4. **FORCE により所有者 `app_owner` にも RLS が効く**。seed・テスト・`db:studio` もテナントを `SET LOCAL` しないと 0 件になる。seed とテストは `withTenantOn(db, associationId, …)` を通す（`src/db/tenant.ts`）

## 理由

- 式を関数にすると、表ごとに書き写す部分がなくなり、`nullif` の扱いを変えるときも 1 か所で済む。`language sql stable` の関数はプランナが展開する
- 「表を足すときの手順」を 1 つのマイグレーションを雛形にして固定すると、付け忘れが grep（`enable row level security` の数 = テナント表の数）で見つかる。A-28（テナント分離のテスト）でこの数を検査する
- 拡張の関数まで止めると、テナント分離と関係のない機能が壊れる。`SECURITY DEFINER` 関数だけを個別に閉じれば、設計の意図（他人のユーザー ID を渡せない・アプリ用ロールだけが呼べる）は満たせる

## 却下した代替案

- ポリシーの式を設計書の文字どおり `current_setting(...)::uuid` にする: トランザクションの外で `''::uuid` のエラーになり、0 件ではなくエラーで倒れる。安全側ではあるが、`/api/health` のような協会に属さない処理まで巻き込みやすい
- `alter default privileges` で新しい表に自動で権限を付ける: RLS を張り忘れた表が全協会から見える（ADR 0001）
- ポリシーを `to app_user, app_job` に限定して所有者を素通しにする: 設計書が FORCE を求めている（誤って所有者で接続したときにも効かせる）
