# 設計書の節の一覧

元: `docs/design.md`（分割: `bash tools/split-design.sh`）。設計書を更新したら再実行する。
作業では、タスクに書かれた節のファイルだけを読む。`00-header.md` と `14-*.md`（決定の記録）は、指示がなければ読まない。

| ファイル | 見出し | KB |
|---|---|---|
| `00-header.md` | 冒頭（版・変更履歴。作業では読まない） | 10.5 |
| `01-0.md` | 1. 目的・背景 | 1.9 |
| `01-1.md` | 1.1 ゴール | 0.9 |
| `01-2.md` | 1.2 非ゴール（v1 ではやらない） | 1.8 |
| `02-0.md` | 2. スコープ・優先度 | 6.3 |
| `03-1.md` | 3.1 ロール v0.8 | 5.2 |
| `03-2.md` | 3.2 権限表 v0.8 | 4.5 |
| `04-1.md` | 4.1 全体フロー（スケッチの再構成） | 1.0 |
| `04-2.md` | 4.2 画面一覧 | 8.9 |
| `04-3.md` | 4.3 UI 方針（モバイルファースト）追加仕様 1 | 4.3 |
| `04-4.md` | 4.4 画面の用語 v0.6 | 5.0 |
| `04-5.md` | 4.5 マイクロインタラクション v0.7 | 7.1 |
| `05-1.md` | 5.1 ログイン・アカウント作成（入口は 1 つ）【S】+v0.6 | 1.4 |
| `05-2.md` | 5.2 ログイン（メール確認番号）【S】を変更 | 1.2 |
| `05-3.md` | 5.3 マイページ 【S】 | 0.9 |
| `05-4.md` | 5.4 大会登録（管理者）【S】 | 9.4 |
| `05-5.md` | 5.5 大会申込み 【S】 | 22.6 |
| `05-6.md` | 5.6 公開範囲と参加チーム一覧 §14-2 | 3.4 |
| `05-7.md` | 5.7 申込完了・自動返信メール 【S】 | 0.6 |
| `05-8.md` | 5.8 メンバー登録（メンバーマスタ）【S】 | 3.6 |
| `05-9.md` | 5.9 大会資料の掲示（P0）§14-2・v0.9.3 で P1 から変更 | 5.0 |
| `05-10.md` | 5.10 問い合わせフォーム（P0）§14-3・v0.9.1 で P1 から変更 | 2.4 |
| `05-11.md` | 5.11 チーム管理（P0）追加要望 1 | 10.4 |
| `05-12.md` | 5.12 協会員登録と年度更新（P0）§14-22 | 9.0 |
| `05-13.md` | 5.13 名簿の出力（P1）§14-22 | 1.9 |
| `05-14.md` | 5.14 マルチテナント（協会）追加要望 2, §14-26 | 18.3 |
| `05-15.md` | 5.15 人・アカウント・チームの関係（重要）§14-25 | 9.0 |
| `05-16.md` | 5.16 削除の方針（論理削除）v0.6 | 7.2 |
| `05-17.md` | 5.17 トップページ（協会のダッシュボード）P1・v0.7 | 6.7 |
| `05-18.md` | 5.18 プライバシーポリシー・利用規約（P0）v0.9.1 | 3.8 |
| `05-19.md` | 5.19 アカウントの管理（P0）v0.9.1 | 3.7 |
| `05-20.md` | 5.20 利用料（課金）v0.9.1 | 3.0 |
| `06-1.md` | 6.1 構成図 | 1.3 |
| `06-2.md` | 6.2 技術選定 | 2.2 |
| `06-3.md` | 6.3 環境と設定 | 4.1 |
| `06-4.md` | 6.4 リポジトリ構成（案） | 2.0 |
| `06-5.md` | 6.5 ホスティング（確定）§14-7・v0.6 | 9.1 |
| `06-6.md` | 6.6 デプロイとマイグレーション v0.9 | 1.6 |
| `06-7.md` | 6.7 監視 v0.9 | 1.0 |
| `07-0.md` | 7.0 テナント（協会）の扱い 追加要望 2 | 2.0 |
| `07-1.md` | 7.1 ER 図 | 10.5 |
| `07-2.md` | 7.2 テーブルの位置づけ | 5.6 |
| `07-3.md` | 7.3 インデックス（主要） | 2.1 |
| `08-1.md` | 8.1 正規化（`normalizeName`）【S】 | 2.3 |
| `08-2.md` | 8.2 例（ユニットテストに流用） | 0.6 |
| `08-3.md` | 8.3 名寄せルール（送信時） | 5.7 |
| `08-4.md` | 8.4 サジェスト検索（`POST /api/[スラッグ]/members/suggest`） | 2.6 |
| `08-5.md` | 8.5 Elasticsearch（ngram）について 【S】 | 0.7 |
| `09-1.md` | 9.1 確認番号ログインのシーケンス | 1.9 |
| `09-2.md` | 9.2 仕様 | 9.9 |
| `09-3.md` | 9.3 マジックリンクを使わない理由 v0.6 | 1.8 |
| `09-4.md` | 9.4 2 段階認証（テナント管理者・運営管理者）P1・v0.8 | 9.2 |
| `10-0.md` | 10. API 一覧 | 14.9 |
| `11-0.md` | 11. メール仕様 | 5.0 |
| `11-1.md` | 11.1 送信ドメイン §14-8 | 3.1 |
| `11-2.md` | 11.2 送信サービス（Brevo・確定）v0.6 | 1.6 |
| `11-3.md` | 11.3 メールが届かないときの案内 v0.6 | 1.4 |
| `12-0.md` | 12. 非機能要件 | 8.2 |
| `12-1.md` | 12.1 テスト方針 v0.9 | 2.3 |
| `13-0.md` | 13. 開発フェーズ | 7.1 |
| `14-1.md` | 14.1 決定済み（2026-09-08 回答） | 2.1 |
| `14-2.md` | 14.2 決定済み（2026-09-08 追加回答 #14〜19、追加仕様 1・2） | 1.8 |
| `14-3.md` | 14.3 決定済み（2026-09-08 追加回答 #20〜24、追加要望 1・2） | 1.7 |
| `14-4.md` | 14.4 決定済み（2026-09-08 追加回答 #25・#26 ほか） | 1.3 |
| `14-5.md` | 14.5 決定済み（2026-09-14 壁打ち） | 5.8 |
| `14-6.md` | 14.6 運用開始までに決めたいこと | 1.9 |
| `14-7.md` | 14.7 将来の検討余地（今回はやらない） | 1.7 |
| `14-8.md` | 14.8 v0.8 レビューで出た、判断が必要な事項 v0.9 → v0.9.1 で回答を反映 | 0.5 |
| `14-9.md` | 14.9 決定済み（2026-09-15 回答・`decisions-v0.9.md`）v0.9.1 | 7.0 |
| `14-10.md` | 14.10 v0.9.1 の確認事項 → v0.9.2 で回答を反映 | 0.3 |
| `14-11.md` | 14.11 決定済み（2026-09-15 回答・`decisions-v0.9.1.md`）v0.9.2 | 2.1 |
| `14-12.md` | 14.12 v0.9.2 の確認事項 → v0.9.3 で回答を反映 | 0.3 |
| `14-13.md` | 14.13 決定済み（2026-09-15 回答・`decisions-v0.9.2.md`）v0.9.3 | 0.9 |
| `14-14.md` | 14.14 確認中（`decisions-v0.9.3.md`）v0.9.3 | 0.2 |
| `appendix-a.md` | 付録 A. DDL（PostgreSQL） | 41.4 |
| `appendix-b.md` | 付録 B. `normalizeName` 実装イメージ（TypeScript） | 1.5 |
| `appendix-c.md` | 付録 C. サジェスト SQL | 2.0 |
| `appendix-d.md` | 付録 D. 年齢判定・締切判定のヘルパー（TypeScript） | 3.2 |
| `appendix-e.md` | 付録 E. 部門バリデーションの擬似コード | 3.6 |
| `appendix-f.md` | 付録 F. 会員資格の判定（年度別） | 2.6 |

## 付録 A（DDL）のテーブルごとのファイル

テーブルを作る作業では `appendix-a.md` 全体ではなく、こちらの必要なファイルだけを読む。

| ファイル | KB |
|---|---|
| `appendix-a/00-extensions.md` | 0.1 |
| `appendix-a/admin_access_logs.md` | 0.8 |
| `appendix-a/association_admin_invitations.md` | 0.9 |
| `appendix-a/association_admins.md` | 1.0 |
| `appendix-a/association_home_layouts.md` | 0.8 |
| `appendix-a/association_slug_history.md` | 0.2 |
| `appendix-a/associations.md` | 1.0 |
| `appendix-a/billing_documents.md` | 0.9 |
| `appendix-a/category_presets.md` | 1.6 |
| `appendix-a/contact_messages.md` | 1.0 |
| `appendix-a/deletion_logs.md` | 0.6 |
| `appendix-a/entries.md` | 2.1 |
| `appendix-a/entry_audits.md` | 0.7 |
| `appendix-a/entry_players.md` | 1.3 |
| `appendix-a/export_logs.md` | 0.6 |
| `appendix-a/login_codes.md` | 1.5 |
| `appendix-a/mail_logs.md` | 1.3 |
| `appendix-a/member_aliases.md` | 0.4 |
| `appendix-a/members.md` | 1.6 |
| `appendix-a/membership_declarations.md` | 0.6 |
| `appendix-a/membership_periods.md` | 0.5 |
| `appendix-a/memberships.md` | 1.3 |
| `appendix-a/platform_admins.md` | 0.6 |
| `appendix-a/platform_contact_messages.md` | 0.6 |
| `appendix-a/player_suggestions.md` | 0.7 |
| `appendix-a/rate_limits.md` | 0.4 |
| `appendix-a/sessions.md` | 1.0 |
| `appendix-a/team_admins.md` | 0.8 |
| `appendix-a/team_invitations.md` | 1.4 |
| `appendix-a/team_members.md` | 1.3 |
| `appendix-a/teams.md` | 1.1 |
| `appendix-a/tournament_categories.md` | 1.2 |
| `appendix-a/tournament_documents.md` | 1.0 |
| `appendix-a/tournaments.md` | 1.5 |
| `appendix-a/user_passkeys.md` | 0.6 |
| `appendix-a/user_recovery_codes.md` | 0.2 |
| `appendix-a/user_totp.md` | 0.2 |
| `appendix-a/users.md` | 0.8 |
| `appendix-a/zz-rls-and-functions.md` | 5.0 |
| `appendix-a/zz-seed.md` | 2.4 |
