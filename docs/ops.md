# 運用手順（Phase 1d 時点）

運営者（ones）とテナント管理者が実際に行う手順。**まだ本番はない**ので、ここは 1a・1b で決まっている範囲。
1c 以降（資料・年度更新）と本番のデプロイ手順は、その作業をするタスクで追記する。

関係する設計書: `docs/design/05-4.md`（大会）、`05-5.md`（申込）、`05-8.md`（要確認の解消）、`05-14.md`（テナント）、`05-16.md`（削除）、`05-19.md`（アカウント）、`06-5.md`（ホスティングとジョブ）、`12-0.md`（保存期間）。

## 0. 全体像（サイトマップと運用の流れ）

この章は全体を見渡すための図だけ。**具体的な手順は 1 章以降**にある。
図の中の `（スラッグ）` は協会ごとの英数字（早良区協会なら `sawara`）。`（大会 ID）` などは実際の ID に置き換わる。
子の画面は親の URL のあとを `…` で省いて書いている。色は下の凡例で全図共通。

```mermaid
flowchart LR
  L1["登場人物"]:::actor
  L2["公開ページ<br/>（ログイン不要）"]:::public
  L3["ログイン・アカウント"]:::auth
  L4["代表者・チームの操作"]:::rep
  L5["申し込み"]:::entry
  L6["協会の管理者の操作"]:::admin
  L7["運営管理者（ones）の操作"]:::platform
  L8["バックエンド（ジョブ・状態）"]:::job
  L9["データの保管先"]:::store

  classDef actor fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef public fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef auth fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef rep fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef entry fill:#ccfbf1,stroke:#0d9488,color:#134e4a
  classDef admin fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef platform fill:#ffe4e6,stroke:#e11d48,color:#881337
  classDef job fill:#e2e8f0,stroke:#475569,color:#1e293b
  classDef store fill:#cffafe,stroke:#0891b2,color:#164e63
```

### 0-1. 登場人物と入口

```mermaid
flowchart LR
  P["選手・保護者・一般<br/>（ログインなしで見られる）"]:::actor --> TOP
  R["チームの代表者"]:::actor --> LI
  A["協会の管理者（役員）<br/>1 協会 5 名まで"]:::actor --> LI
  O["サイト運営者（ones）"]:::actor --> LI

  LI["ログイン<br/>/login"]:::auth -->|"6 桁の確認番号をメールで受け取る"| CODE["確認番号の入力<br/>/login/code"]:::auth
  CODE -.->|"届かないとき"| HELP["メールが届かないとき<br/>/login/help"]:::auth
  CODE --> HOME["自分が関わる協会の一覧<br/>/"]:::auth

  HOME --> TOP["協会のトップ<br/>/（スラッグ）"]:::public
  HOME --> MY["マイページ<br/>/mypage"]:::auth
  HOME --> PF["運営管理<br/>/platform<br/>（運営管理者だけ）"]:::platform

  MY --> EM["メールアドレスの変更<br/>/mypage/email"]:::auth
  MY --> DEL["アカウントの削除<br/>/mypage/delete"]:::auth
  MY --> INV["招待（参加する・断る）<br/>/invitations"]:::auth

  FOOT["どの画面のフッタからも<br/>サイトへの問い合わせ /contact<br/>プライバシーポリシー /privacy<br/>利用規約 /terms"]:::public

  classDef actor fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
  classDef public fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef auth fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef platform fill:#ffe4e6,stroke:#e11d48,color:#881337
```

### 0-2. サイトマップ（選手・代表者が使う画面）

```mermaid
flowchart TD
  TOP["協会のトップ<br/>/（スラッグ）"]:::public

  subgraph pub["ログインなしで見られる"]
    TL["大会一覧<br/>/（スラッグ）/tournaments"]:::public
    TDET["大会の詳細<br/>…/tournaments/（大会 ID）"]:::public
    PL["参加チーム一覧<br/>…/（大会 ID）/entries"]:::public
    DOC["大会の資料 PDF<br/>…/（大会 ID）/documents/（資料 ID）"]:::public
    CT["協会への問い合わせ<br/>/（スラッグ）/contact"]:::public
  end

  subgraph rep["代表者（ログインが要る）"]
    TN["チームの登録<br/>/（スラッグ）/teams/new"]:::rep
    TP["チームのページ<br/>/（スラッグ）/teams/（チーム ID）"]:::rep
    TE["チーム情報の変更<br/>…/edit"]:::rep
    ML["選手一覧<br/>…/members"]:::rep
    MN["選手の追加<br/>…/members/new"]:::rep
    ME["選手の情報の修正<br/>…/members/（選手 ID）/edit"]:::rep
    AM["代表者の追加・交代<br/>…/admins"]:::rep
    MS["協会員の申告<br/>…/membership<br/>（年度更新の受付中だけ）"]:::rep
  end

  subgraph ent["申し込み"]
    EF["大会に申し込む<br/>…/（大会 ID）/entry"]:::entry
    EC["内容を確かめる<br/>…/entry/confirm"]:::entry
    EV["申し込みの内容<br/>/（スラッグ）/entries/（申込 ID）"]:::entry
    EE["内容を変える<br/>…/（申込 ID）/edit<br/>（締切前だけ）"]:::entry
  end

  TOP --> TL
  TOP --> CT
  TOP --> TN
  TOP --> TP
  TL --> TDET
  TDET --> PL
  TDET --> DOC
  TDET -->|"受付中・ログイン済み・代表者"| EF
  EF --> EC -->|"送信"| EV
  EV --> EE --> EV
  TP --> TE
  TP --> ML
  TP --> AM
  TP --> MS
  TP --> EV
  ML --> MN
  ML --> ME

  classDef public fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef rep fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef entry fill:#ccfbf1,stroke:#0d9488,color:#134e4a
```

### 0-3. サイトマップ（協会の管理者・サイト運営者）

```mermaid
flowchart TD
  AD["協会の管理<br/>/（スラッグ）/admin"]:::admin

  subgraph t["大会"]
    TRN["大会の管理<br/>/（スラッグ）/admin/tournaments"]:::admin
    TNW["大会を作る<br/>…/new"]:::admin
    TED["大会の編集（部・締切・定員）<br/>…/（大会 ID）"]:::admin
    DCS["大会の資料<br/>…/（大会 ID）/documents"]:::admin
    ENT["申し込みの管理・要確認<br/>…/（大会 ID）/entries"]:::admin
    CSV["CSV のダウンロード（API）<br/>/api/（スラッグ）/admin/tournaments/（大会 ID）/entries/exports"]:::admin
  end

  subgraph p["人とチーム"]
    MEM["メンバー管理<br/>/（スラッグ）/admin/members"]:::admin
    MD["人物のページ<br/>…/（人物 ID）"]:::admin
    RV["登録の確認（同じ人かを見る）<br/>…/（人物 ID）/review"]:::admin
    TMS["チーム管理<br/>/（スラッグ）/admin/teams"]:::admin
    TMD["チームの詳細<br/>…/（チーム ID）"]:::admin
    MSH["協会員の管理（年度更新）<br/>/（スラッグ）/admin/memberships"]:::admin
  end

  subgraph o["そのほか"]
    CTS["問い合わせ管理<br/>/（スラッグ）/admin/contacts"]:::admin
    ASC["協会の設定<br/>/（スラッグ）/admin/association"]:::admin
    TRS["削除済みデータ（復元）<br/>/（スラッグ）/admin/trash"]:::admin
  end

  AD --> TRN --> TNW
  TRN --> TED --> DCS
  TED --> ENT --> CSV
  AD --> MEM --> MD
  MEM --> RV
  AD --> TMS --> TMD
  AD --> MSH
  AD --> CTS
  AD --> ASC
  AD --> TRS

  PF["運営管理<br/>/platform"]:::platform --> PA["協会の設定・管理者の招待<br/>/platform/associations/（協会 ID）"]:::platform
  PF --> PC["サイトへの問い合わせ<br/>/platform/contacts"]:::platform
  PA -->|"切り替えて入る（1 時間で切れる・記録が残る）"| AD

  classDef admin fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef platform fill:#ffe4e6,stroke:#e11d48,color:#881337
```

### 0-4. 運用の流れ（大会 1 回分）

```mermaid
flowchart TD
  S1["① 大会を作る（できた直後は準備中）<br/>/（スラッグ）/admin/tournaments/new"]:::admin
  S2["② 部を足す・締切・基準日・定員を決める<br/>…/admin/tournaments/（大会 ID）"]:::admin
  S3["③ 資料（PDF）を置いて公開する<br/>…/（大会 ID）/documents<br/>個人情報が入っていないか確かめる"]:::admin
  S4["④ 受付中にする<br/>公開ページ /（スラッグ）/tournaments に出る"]:::admin
  S5["⑤ 代表者が申し込む<br/>/（スラッグ）/tournaments/（大会 ID）/entry"]:::entry
  S6["⑥ 要確認を片づける・代理で直す<br/>…/（大会 ID）/entries"]:::admin
  S7["⑦ 締切<br/>代表者は直せなくなる（管理者は可）"]:::job
  S8["⑧ 申し込みの管理から CSV を出す<br/>…/（大会 ID）/entries<br/>生年月日はチェックしたときだけ"]:::admin
  S9["⑨ 組み合わせ表を資料に置く<br/>…/（大会 ID）/documents"]:::admin
  S10["⑩ 大会当日"]:::job
  S11["⑪ 使い終わった CSV を消す<br/>資料を非公開に戻す"]:::admin

  M1["申込の控えメール<br/>代表者へ"]:::job
  B1["日次ジョブ ②<br/>申込一覧を暗号化してバックアップ<br/>（締切の翌日〜開催日の翌日まで毎日）"]:::job

  S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> S9 --> S10 --> S11
  S5 -.-> M1
  S7 -.-> B1
  S6 -.->|"同じ人かもしれない"| RV["登録の確認<br/>/（スラッグ）/admin/members"]:::admin

  classDef admin fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef entry fill:#ccfbf1,stroke:#0d9488,color:#134e4a
  classDef job fill:#e2e8f0,stroke:#475569,color:#1e293b
```

### 0-5. 1 年の流れ（協会員の年度更新）

```mermaid
flowchart LR
  Y1["3 月まで<br/>受付の設定を決める<br/>年度・受付期間・承認を省くか"]:::admin
  Y2["4/1 受付開始<br/>/（スラッグ）/admin/memberships<br/>代表者の画面に案内が出る"]:::admin
  Y3["4〜6 月<br/>代表者が申告<br/>…/teams/（チーム ID）/membership"]:::rep
  Y4["承認<br/>/（スラッグ）/admin/memberships<br/>まとめて承認・代理で申告"]:::admin
  Y5["6/30 締切<br/>ここまでが通常の申告"]:::job
  Y6["7 月〜年度末<br/>追加の申告（増やすだけ）<br/>承認を省く年度でも承認が要る"]:::rep
  Y7["3/31 年度の終わり"]:::job

  Y1 --> Y2 --> Y3 --> Y4 --> Y5 --> Y6 --> Y7
  Y4 -.->|"承認のメール"| R1["代表者"]:::actor
  T1["大会は 1 年を通して随時<br/>0-4 の流れ"]:::job -.->|"開催日の年度で会員かを見る"| Y4

  classDef admin fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef rep fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  classDef job fill:#e2e8f0,stroke:#475569,color:#1e293b
  classDef actor fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
```

### 0-6. 裏で動くもの（ジョブ・メール・保存先）

```mermaid
flowchart LR
  APP["サイト本体<br/>本番: Cloud Run / ローカル: pnpm dev"]:::job

  APP -->|"送信待ちに積む"| OB[("メールの送信待ち<br/>outbox（DB）")]:::store
  JM["メールの送信<br/>pnpm job:mail（数分おき）"]:::job --> OB
  JM --> MAIL["本番: Brevo<br/>ローカル: Mailpit http://localhost:8025"]:::job

  JD["日次の後始末<br/>pnpm job:daily（毎日 3:00）"]:::job --> J2["② 締切後の申込一覧を暗号化してバックアップ"]:::job
  JD --> J3["③ 期限切れの確認番号・セッション・レート制限を消す"]:::job
  JD --> J4["④ 期限切れの招待を expired にして知らせる"]:::job
  JD --> J5["⑤ 保存期間を過ぎた記録を消す"]:::job
  JD --> J6["⑥ どこからも指されていない資料のファイルを消す"]:::job

  APP --> DB[("Postgres<br/>本番: Neon / ローカル: db:5432")]:::store
  APP --> ST["ファイル<br/>本番: R2（公開用・保管用・バックアップ用）<br/>ローカル: .local-storage/"]:::store
  APP --> LOG["操作ログ（1 リクエスト 1 行）<br/>本番: Cloud Logging（stdout）<br/>ローカル: logs/access.log"]:::job
  J2 --> ST
  J6 --> ST
  APP -.->|"つながっているか"| HC["/api/health"]:::job

  classDef job fill:#e2e8f0,stroke:#475569,color:#1e293b
  classDef store fill:#cffafe,stroke:#0891b2,color:#164e63
```

## 1. 協会（テナント）を増やす

1. 運営管理者で `/platform` を開く → 「協会を追加する」→ 協会名とスラッグ（URL に出る英数字）を入れる
2. スラッグはあとから変えられるが、古い URL は転送になるだけなので、**最初に協会と相談して決める**
3. 作った協会のページで「管理者を招待する」→ 相手のメールアドレス（招待は 7 日で切れる）

**招待の前に必ず本人確認をする**（メールアドレスの取り違えは個人情報の事故になる）。
- 協会の役員名簿など、協会側の資料でアドレスを確かめる。電話か対面で「いまから招待を送ります」と伝えてから送る
- 招待を送ったら、相手がログインして `/invitations` で「参加する」を押すまで権限は付かない
- 管理者は 1 協会 5 名まで（返事待ちの招待も数える）。退任した人は `/platform` の協会のページで解除する

## 2. 役員・代表者へのログインの案内

パスワードはない。**メールアドレスに届く 6 桁の確認番号**で入る。案内の文面の型:

> 1. https://（サイトの URL）/（協会のスラッグ）/ を開く
> 2. 「ログイン」→ メールアドレスを入れて「確認番号を送る」
> 3. 届いたメールの 6 桁の番号を、**同じ画面・同じ端末**で入れる（番号は 10 分で切れます）

よくあるつまずき:
- メールが届かない → 迷惑メールを見てもらう。それでもなければ、アドレスの綴りを一緒に確かめる
- 番号を入れる画面を閉じてしまった → 番号は使えなくなるので、最初から送り直す（別の端末で入れても通らない）
- 協会の管理者は**同時に 1 つの端末だけ**ログインできる。別の端末で入れないときは、前の端末でログアウトしてもらう（30 分以上使っていなければ自動で切れる）

## 3. 大会と申込（1b）

### 大会を開くまで

1. `/（スラッグ）/admin/tournaments` →「大会を作る」。大会名・開催日・**年齢の基準日**（開催日を入れると同じ日が入る）・会場・申し込みの開始日と締切日・参加人数の下限と上限・申し込みの上限を入れる。作った直後は**準備中**（利用者には見えない）
2. 同じ画面で「部を足す」。よく使う部（プリセット）から選ぶ。大会ごとに**表示名を変えられる**（「混合」→「MIX」）。部ごとに締切・基準日・上限を変えられる（空欄なら大会の値）
3. 内容を確かめて、状態を**受付中**にする。公開ページ（`/（スラッグ）/tournaments`）に出て、申し込めるようになる
4. 基準日を変えたときは、すでにある申込の年齢がずれるので、画面の警告に従って「新しい基準日で確定する」を押す

### 締切までの間

| こんなとき | すること |
|---|---|
| 申し込みを確かめたい | `/（スラッグ）/admin/tournaments/（大会）/entries`。部ごとの件数と、**要確認**の印が出る |
| 「要確認」の印が付いている | 合計年齢の部か、同じ人かもしれない選手がいる申込。内容を確かめて「確認済みにする」 |
| 代表者から「直したい」と連絡が来た | 締切前なら代表者自身が申込のページから直せる。締切後は管理者が「代理で直す」（記録が残る） |
| 同じチームが二重に申し込んでいる | 代表者に取り消してもらう。誤登録なら管理者が「誤登録として削除する」（削除済みデータから戻せる） |
| 定員を超えて入れたい | 管理者として申込ページを開けば、締切後・定員超過でも登録できる |

### 締切のあと

1. `/（スラッグ）/admin/tournaments/（大会）/entries` →「CSV をダウンロード」。1 人 1 行。**生年月日はチェックを入れたときだけ**入る（印刷して配る資料には入れない）
2. CSV を出したことは記録される（誰が・いつ・生年月日を含めたか）。**要らなくなったファイルは消す**
3. 日次ジョブが、すべての部の締切を過ぎた大会の申込一覧を、**開催日の翌日まで毎日**暗号化してバックアップに保存する（下の「4. 定期ジョブ」）

### 同じ人が二重に登録されていたら（§5.8）

1. `/（スラッグ）/admin/members` の「確認が必要」から開く。氏名・生年月日・チーム・申込の回数・ログインの有無を横に並べて比べる
2. 別の人なら「別の人です」。同じ人なら「まとめる」→ 残す登録を選んで確定（**元に戻せない**）
3. どちらの登録にも別々のアカウントが結びついているときはまとめられない。先にどちらかの結びつきを解除する（本人のマイページか、管理者の人物のページ）

## 3-2. 大会の資料（PDF・1c）

- 置き場所: 大会の編集 →「大会の資料（PDF）」
- PDF だけ・1 ファイル 10 MB まで。拡張子を `.pdf` に変えた画像は受け付けない（中身も見ている）
- **公開する前に、個人情報が入っていないか必ず確かめる**。公開した資料は大会に関係のない人でも開ける（組み合わせ表の氏名もそのまま公開される）
- 公開／非公開は後から切り替えられる。非公開・削除・大会を「準備中」に戻すと、公開用の置き場から消える（**配信のキャッシュの都合で、最長 1 時間は開ける場合がある**）
- ファイルを差し替えると URL が変わる。**前に LINE などで配った URL は開けなくなる**ので、差し替えたら大会ページの案内も直す
- 利用者に配るのは大会ページの資料のリンク（`/<スラッグ>/tournaments/<大会の ID>/documents/<資料の ID>`）。期限はない

## 3-3. 協会員の年度更新（1d）

- 受付を開く: 管理 →「協会員の管理（年度更新）」→ 年度・受付の開始日・締切日（早良区協会の 2027 年度は 4/1〜6/30）→「受付を始める」
  - 「承認を省く」に入れると、代表者が送った時点で協会員になる（会費の入金を確かめてから承認する運用なら、入れない）
  - 受付を開くと、**協会員の登録をするチーム**の代表者のトップと画面に案内が出る。**依頼メールの一斉送信と督促はまだできない**（電話・LINE などで知らせる）
- 承認: 同じ画面の「承認待ちの申告」→「このチームをまとめて承認する」または「承認待ちのすべてを承認する」。承認すると代表者にメールが届く
- 未申告のチーム: 同じ画面の一覧から「代理で申告する」で運営が入力できる（締切後も可）
- 締切後: 代表者は**追加の申告**（増やすだけ）が年度末まで送れる。**承認を省く年度でも承認が必要**なので、「追加の申告」の欄を時々見る
- 外したい人がいる連絡が来たら、運営が「代理で申告する」からチェックを外して送り直す
- 「協会員の登録をするチーム」でないチームには申告の画面が出ない。チーム情報（代表者・管理者のどちらでも変えられる）で切り替える

## 4. 日々の運用

| いつ | すること |
|---|---|
| 問い合わせが来たら | 協会宛ては `/（スラッグ）/admin/contacts`、サイト運営者宛ては `/platform/contacts`。返事はメールで直接返し、画面では「対応済み」にする |
| 選手・チームの間違いの直し | 代表者ができるのは「選手一覧から外す」まで。**人物の削除・誤登録の行の削除は協会の管理者**（`/（スラッグ）/admin`） |
| 消したものを戻したい | `/（スラッグ）/admin/trash`（削除済みデータ）から復元。完全に削除すると戻せない（理由の入力が要る） |
| アカウントを消したいと言われたら | 本人が `/mypage/delete` から消す。代表者・管理者のままでは消せないので、先に交代してもらう |

## 5. 定期ジョブ（本番は Cloud Scheduler・§6.5.1）

| ジョブ | 間隔 | ローカルでの流し方 |
|---|---|---|
| メールの送信 | 数分おき | `pnpm job:mail` |
| 日次の後始末（期限切れの確認番号・セッション・レート制限の削除、期限切れの招待を `expired` にして知らせる、保存期間を過ぎた記録の削除、**締切後の申込一覧 CSV のバックアップ**） | 毎日 3:00（日本時間） | `pnpm job:daily` |

- 日次ジョブの **②③④⑤**が入っている。DB のバックアップ（`pg_dump`）・R2 の後始末・最小インスタンス数の切り替えは未実装（C 以降）

### 申込一覧 CSV のバックアップ（②・設計書 §5.5(f)・§6.5）

- すべての部の締切を過ぎた大会について、**開催日の翌日まで毎日**、申込一覧の CSV（生年月日は含めない）を作り、**公開鍵で暗号化して**バックアップ用の保存先に置く
  - 置き場所: ローカルは `.local-storage/backup/entries/<協会 ID>/<大会 ID>/<日付>.csv.enc`、本番は R2 のバックアップ用バケット（`R2_BACKUP_BUCKET`）
  - 鍵: 本番は `BACKUP_ENCRYPTION_KEY`（**公開鍵だけ**をジョブに渡す。復号用の秘密鍵は Secret Manager とは別の場所に保管する）。ローカルは `.local-storage/backup-test-key.json` にテスト用の鍵ができる
- 復号のしかた（中身を確かめるとき）: `src/lib/storage/encrypt.ts` の `decryptBackup(秘密鍵, ファイルの中身)`。形式は「BBP1 ＋ 使い捨ての公開鍵 32 バイト ＋ IV 12 バイト ＋ 暗号文 ＋ 認証タグ 16 バイト」（X25519 ＋ AES-256-GCM）
- 記録の保存期間は `docs/design/12-0.md` の表。人物（`members`）は自動では消さない（管理画面で確かめてから物理削除する）

### 資料のファイルの後始末（⑥・設計書 §5.9・§6.5.1）

- 大会を「完全に削除」するとファイルもその場で消える。消し損ねた分（DB のどの行からも指されていないファイル）は日次ジョブが消す
- ローカルで確かめるなら `pnpm job:daily` → ログの「資料の後始末 公開用 ◯ 件 / 保管用 ◯ 件」

## 6. 試験運用（身内で試す）の手順

本番の前に、身内（協会の役員・知り合いのチーム）に試してもらうときの順番。

1. 準備: `pnpm db:seed`（協会と部のプリセット）→ `pnpm db:seed:dev`（サンプルのチームと選手）→ `pnpm dev`
2. 管理者を作る: `pnpm dev:grant-admin （自分のアドレス） sawara` → ログイン → `/sawara/admin`
3. 大会を 1 つ作る（上の「3. 大会と申込」）。**部は 2 つ以上**にして、片方の締切を近い日にしておくと、締切の動きも試せる
4. 試してもらう人に案内を送る（上の「2. 役員・代表者へのログインの案内」の文面）。チームの登録 → 選手の登録 → 申込 → 変更 → 取消 まで、**スマートフォンで**通してもらう
5. 見てもらう点: 文字の大きさ・押しやすさ・言葉の分かりにくさ・迷った場所。**画面の写真を撮ってもらう**と直しやすい
6. メールは `pnpm job:mail` を流さないと届かない（ローカル）。届いたメールは http://localhost:8025 で確認できる
7. 終わったら: 気づいたことを `docs/progress.md` の申し送りに書く。個人情報を含むサンプルは `pnpm db:reset` で消す

## 6-2. 画面の見え方を確かめる（3 つの幅・文字サイズ拡大・タップ領域）

画面を直したら、**主要な 10 画面**を 375 / 768 / 1280 の幅 × 文字サイズ 100% / 150% / 200% で開いて、
横にはみ出さないか・押せるものが 44px 以上あるかを機械で確かめる（設計書 §4.3「検証」・§12「動作確認の範囲」・U-06）。

```bash
pnpm dev                       # 別の端末で起こしておく
pnpm test:e2e --project=chromium-1280x800 tests/e2e/screens.spec.ts
```

- 幅はテストの中で変えるので、**プロジェクトは 1 つだけ**指定する（指定しないと同じことを 3 回流す）
- スクリーンショットは `test-results/screens-…/<画面>-<幅>-<文字サイズ>.png` に 90 枚出る。目で見るのはここ
- 失敗したときは、はみ出している要素（いちばん内側から 5 つ）と、44px に足りない操作が
  エラーの文に出る。よくある原因は次の 2 つ:
  - **格子・flex の升目が縮まない**（既定の `min-width: auto`）。長い大会名・チーム名で起きる。
    格子は `globals.css` でまとめて `min-width: 0` にしてあるので、flex のときだけ `min-w-0` を足す
  - **丸・アイコンが rem で大きくなって 1 行に入らない**。`flex-wrap` を足して折り返す
- 文字サイズの拡大は、根の文字サイズ（`html { font-size }`）を 24px・32px にして真似る。
  端末の「文字を大きく」と同じ効き方になる（大きさはすべて rem で書いてあるため）
- らくらくスマートフォンの実機は運営が持っていないので、**試用のときに利用者の端末を見せてもらう**（§12）

## 7. 障害・問い合わせの記録

- ジョブが失敗したときの知らせ先、本番へのアクセス権を持つ人、担当者が欠けたときの引き継ぎは**運営者（ones）が決める**（設計書 §14.9 D-5）。決めたらここに書く
- 個人情報を含む画面を運営管理者が見るには、その協会に「切り替えて入る」必要があり、記録が残る（`admin_access_logs`）。**入ったままにしない**（1 時間で切れる）

### 操作ログ（誰がどの画面で何をしたか・docs/adr/0027）

「申し込んだはずなのに入っていない」「締切に間に合ったはず」という問い合わせの切り分けに使う。
**リクエストだけ**を 1 行 1 件（JSON）で残す。応答の結果は残らない。

- ローカル・自前サーバー: `logs/access.log`（`ACCESS_LOG_DRIVER=file`）。
  日本時間の月が変わるか 100 MB を超えると `access-YYYYMMDD-HHMMSS-NN.log` に退避し、**6 世代（半年分）**残して古いものから消える
- 本番（Cloud Run）: 標準出力 → Cloud Logging（`ACCESS_LOG_DRIVER=stdout`）。ファイルは残らない

```bash
# 9/21 の、ある協会の申込まわりの動き
grep '"slug":"sawara"' logs/access.log | grep '"at":"2026-09-21' | grep entries

# ある人の動きを追う（① セッションのハッシュを調べる → ② そのハッシュで絞る）
#   ① psql で: select session_hash from sessions where user_id = '…';
grep '"session":"<①のハッシュ>"' logs/access.log
```

- 氏名・メールアドレス・生年月日は**ログに入らない**（URL に載せない決まり。万一入ってもクエリの値は `***` になる）。
  人をたどるのはセッションのハッシュから。セッションは期限切れで消えるため、**古いログからは人をたどれない**
- 見た結果を問い合わせの返事に使うときは、ログの中身をそのまま貼らない（IP と User-Agent が入っている）

## 8. まだ決めていないこと（本番の前に決める）

- 本番のデプロイ手順（Cloud Run・Neon・R2 の作成と Secret の置き場所）
- バックアップの復元手順（Phase 0 で確認する）
- 監視の知らせ先（メール・電話）と、深夜・休日の扱い
- プライバシーポリシー・利用規約の【要確認】（`docs/legal/*.md` の末尾）を専門家に見てもらう
