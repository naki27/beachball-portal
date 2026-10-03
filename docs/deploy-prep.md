# 本番環境の準備チェックリスト

X-01〜X-05（`docs/p0-tasks.md` §6）を始める前に、人が行う準備。構成は設計書 `docs/design/06-5.md`（ホスティング）・`06-6.md`（デプロイ）のとおり。

- **すべてのアカウントは運営者（ones）の名義で作り、ones が支払う**（§14.9 D-5）
- 各項目の「控える」は 2 種類に分ける
  - 🟢 **Claude に渡す**: 秘密ではない識別子。最後の「渡す情報のひな形」に書いて渡す
  - 🔒 **自分で保管する**: パスワード・API キー・秘密鍵。**チャットに貼らない・リポジトリに入れない**。いったんパスワード管理ツールに控え、Secret Manager へは X-01・X-02 で用意する手順で入れる
- 無料枠・料金・画面の名前は変わることがある。契約の前に各社の公式ページで確かめる

---

## 0. 先に決めること

- [x] 本番のドメイン（例: `entry.fukuoka-city-beachball.org`）。協会のドメインを使ってよいか、協会の了承を取る
- [x] 大会資料を配信するサブドメイン（例: `files.entry.fukuoka-city-beachball.org`・ADR 0026）
- [x] メールの送信ドメイン（例: `mail.fukuoka-city-beachball.org`・§11.1）と送信元のアドレス（例: `no-reply@mail.…`）
- [x] 問い合わせの転送先のアドレス（`CONTACT_TO`）
- [x] 最初の運営管理者のメールアドレス（2 名以内・`SUPER_ADMIN_EMAILS`）
- [x] 予算アラートとジョブの失敗の通知先のメールアドレス

## 1. GitHub

- [x] リポジトリの管理者の権限がある（Environments・Secrets を設定するため）
- [x] Actions が有効になっている（CI は `.github/workflows/ci.yml` で動いている）
- [x] `feature/cd` を `main` に取り込むか決める（デプロイは `main` へのマージで動く・§6.6）

控える:
- 🟢 リポジトリの `owner/name`

## 2. GCP（Cloud Run・Artifact Registry・Secret Manager・Cloud Scheduler・WIF）

- [x] Google アカウント（ones の名義）を用意する
- [x] 請求先アカウントを作る（支払い方法を登録する）
- [x] プロジェクトを 1 つ作り、請求先アカウントにつなぐ
- [x] 予算アラートを設定する（例: 月 1,000 円。50%・90%・100% で通知）
- [x] 作業する人の PC に `gcloud` CLI を入れ、`gcloud auth login` できることを確かめる（初回の設定用スクリプトはこの PC で実行する。Dev Container の中では実行しない）
- [x] 作業する人のアカウントがプロジェクトの「オーナー」になっている（初回の設定だけに使う）

API の有効化・サービスアカウント・Workload Identity Federation・Artifact Registry・Secret の器は、X-02 のスクリプトで作る（手で作らない）。

控える:
- 🟢 プロジェクト ID（例: `beachball-portal-prod`）
- 🟢 プロジェクト番号（数字 12 桁前後。WIF の設定に使う）
- 🟢 リージョン: `asia-southeast1`（固定）
- 🟢 予算アラートの通知先

## 3. Neon（PostgreSQL）

- [x] アカウントを作る（無料プラン）
- [x] プロジェクトを作る: **PostgreSQL 16**・リージョンは **AWS Asia Pacific（Singapore）/ `aws-ap-southeast-1`**
- [x] データベースを 1 つ作る（例: `beachball`）
- [x] 最初からあるブランチ（`main` など）を本番に使う

アプリ用のロール（`app_owner`・`app_user`・`app_job`・`app_backup`・`app_definer`）は `pnpm db:roles` で作る。パスワードの決め方と接続 URL の組み立ては X-01 で決める（Neon の画面では作らない）。

控える:
- 🟢 プロジェクト ID
- 🟢 ホスト名 2 つ: **pooled**（`-pooler` の付くもの）と **direct**
- 🟢 データベースの名前
- 🟢 管理用のロールの名前（プロジェクトを作ったときにできるもの）
- 🔒 管理用のロールのパスワード（接続文字列の中のもの）

## 4. Cloudflare（R2・配信）

- [x] アカウントを作る
- [x] R2 を有効にする（無料枠でも支払い方法の登録が要る）
- [x] バケットを 3 つ作る。ロケーションのヒントは **Asia-Pacific（APAC）**。3 つとも非公開のまま作る
  - 保管用（`beachball-origin-files`）。`R2_BUCKET`
  - 公開用（`beachball-public-files`）。`R2_PUBLIC_BUCKET`。配信は Workers（ADR 0033・X-05）
  - バックアップ用（`beachball-backup-files`）。`R2_BACKUP_BUCKET`（名前が `R2_BUCKET`＋`-backup` でないので必ず書く）。全員の生年月日を含むので、ほかと必ず分ける
  - ストレージクラスは 3 つとも Standard（無料枠は Standard だけ）
- [x] R2 の API トークンを作る（Account API token）
  - アプリ用: 保管用・公開用のバケットだけに「Object Read & Write」
  - バックアップ用: バックアップ用のバケットだけ。画面で選べる権限に「書き込みだけ」はないので、ひとまず「Object Read & Write」。X-03 で見直す
  - ⚠️ いまのコード（`src/lib/storage/index.ts`）は 3 つのバケットに 1 組のキーを使う。バックアップ用のキーを渡す環境変数を X-03 で足すまで、本番の日次ジョブのバックアップは権限がなくて失敗する
- [x] `entry.` のサブドメインを Cloudflare に任せられるか確かめる（§14.9 D-4）→ **任せられない**。無料プランはルートドメインしか追加できない（Subdomain setup は Enterprise だけ）。ドメイン全体の DNS を移すのは影響が大きいので、公開用は Workers で配信する（ADR 0033）
- [x] Notifications で、使用量に応じた請求の通知（Usage Based Billing）を設定する（R2 は無料枠を超えると止まらずに請求される）

ライフサイクルの設定（バックアップの日次 30 世代＋月初 3 世代）は X-03 で行う。

控える:
- 🟢 アカウント ID（R2 の画面に出る 32 桁）
- 🟢 3 つのバケットの名前
- 🟢 D-4 の結果（任せられる / 任せられない）
- 🔒 各トークンの Access Key ID と Secret Access Key（Secret は作った画面でしか見られない）

## 5. Brevo（メール）

- [x] アカウントを作る（ones の名義。無料プランの 1 日の送信数の上限を確かめる・§11.2）
- [x] 送信ドメイン（`mail.…`）を登録し、表示された DNS レコード（SPF・DKIM・DMARC・確認用の TXT）を Wix の DNS に入れる → Brevo の画面で「認証済み」になるまで確かめる
- [x] 送信元のアドレスを登録する
- [x] API キーを作る（SMTP のキーではなく API キー）

配信状況の Webhook（`BREVO_WEBHOOK_TOKEN`）の設定は X-01 で行う。

控える:
- 🟢 送信ドメインと送信元のアドレス（`MAIL_FROM`）
- 🟢 プランと 1 日の送信数の上限
- 🔒 API キー（`MAIL_API_KEY`）

## 6. Wix（ドメイン・DNS・既存）

- [x] 協会のドメインの DNS を編集できるログインがある（または、協会に頼む窓口と手順が決まっている）
- [x] CNAME・TXT のレコードを足せることを確かめる（Wix の「ドメイン」→ 対象のドメイン →「DNS レコードを管理」。ホスト名の欄はドメインの手前の部分だけを入れる）
- [x] ネームサーバーが Wix のもの（`ns*.wixdns.net`）か確かめる。ほかのものなら、レコードはそちらの DNS に入れる

本番のドメインを Cloud Run に向ける設定は X-05 で行う。

控える:
- 🟢 DNS を編集できる人（自分で編集できるか、協会に頼むか）

## 7. バックアップの暗号化の鍵

- [x] 鍵の作り方は X-03 で用意する。**秘密鍵を保管する場所**（Secret Manager とは別。例: ones の金庫・オフラインの USB）と保管する人だけを先に決める

控える:
- 🟢 保管場所と保管する人（場所の名前だけ。鍵の中身は渡さない）

---

## 渡す情報のひな形

すべて埋めたら、このまま Claude に渡す（🔒 の値は書かない）。**このリポジトリは公開なので、埋めた値はここに書かずに `docs/deploy-values.local.md`（Git に入れない）に書く。**

```text
[決めたこと]
本番のドメイン:
資料の配信ドメイン:
メールの送信ドメイン / 送信元:
問い合わせの転送先（CONTACT_TO）:
予算アラート・ジョブ失敗の通知先:

[GitHub]
リポジトリ（owner/name）:

[GCP]
プロジェクト ID:
プロジェクト番号:
gcloud を使える PC: あり / なし

[Neon]
プロジェクト ID:
pooled のホスト名:
direct のホスト名:
データベースの名前:
管理用のロールの名前:

[Cloudflare]
アカウント ID:
保管用のバケット:
公開用のバケット:
バックアップ用のバケット:
D-4（entry. を Cloudflare に任せられるか）:
バックアップ用のトークンを書き込みだけにできたか:

[Brevo]
プラン / 1 日の上限:
送信ドメインの認証: 済み / まだ

[DNS]
DNS を編集する人: 自分 / 協会に依頼

[バックアップの鍵]
秘密鍵の保管場所と保管する人:
```
