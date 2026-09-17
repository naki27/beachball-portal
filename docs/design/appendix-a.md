## 付録 A. DDL（PostgreSQL）

```sql
create extension if not exists pg_trgm;
create extension if not exists citext;

-- テナント（協会）
create table associations (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  slug                     text not null unique,          -- sawara
  contact_email            citext,                        -- 問い合わせの転送先・メールの Reply-To（§5.10・§11）
  fiscal_year_start_month  int  not null default 4 check (fiscal_year_start_month between 1 and 12),
  theme_colors             jsonb,                         -- {base, main, accent} のカラーコード。NULL は既定の色（P1・§5.17）
  logo_storage_key         text,                          -- ロゴ（R2 のキー）
  billing_plan             text check (billing_plan in ('monthly','annual')),  -- 利用料のプラン（§5.20・P1）
  status                   text not null default 'active', -- 停止などの状態は利用料と一緒に決める（§5.20）。協会は物理削除しない
  created_at               timestamptz not null default now()
);

-- トップページの構成（§5.17）。1 版 1 行。公開中はテナントに 1 行だけ
create table association_home_layouts (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete cascade,
  status         text not null check (status in ('draft','published','archived')),
  blocks         jsonb not null,               -- [{type, visible, settings, body}] 保存時に zod で検査
  created_by     uuid,
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  published_by   uuid
);
create unique index home_layouts_published_uk
  on association_home_layouts (association_id) where status = 'published';
create unique index home_layouts_draft_uk
  on association_home_layouts (association_id) where status = 'draft';

create table users (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null,
  display_name      text,
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  terms_version     text,                         -- 同意した利用規約・プライバシーポリシーの版（§5.18）
  terms_accepted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,                  -- 論理削除（§5.16）。本人による削除では email を元に戻せない値に置き換える（§5.19）
  deleted_by        uuid
);
create unique index users_email_uk on users (email) where deleted_at is null;

-- 論理削除の列（deleted_at / deleted_by）は §5.16 の対象テーブルすべてに付け、以下の DDL に明記する（v0.9）。
-- 一意制約は削除済みを除く部分インデックスにする（§5.16）。
-- テナントに属するテーブルはすべて association_id を持ち、子は (association_id, 親の id) の複合外部キーで親を参照する（§5.14）。

-- 協会の管理者（users.role の代わり。テナントごとに持つ）
create table association_admins (
  association_id uuid not null references associations(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  granted_at     timestamptz not null default now(),
  granted_by     uuid references users(id),       -- 招待した運営管理者（§5.14）
  mfa_enroll_by  timestamptz,                     -- この日時までに 2 段階認証を登録（承諾 + 7 日【仮】・§9.4・P1）
  primary key (association_id, user_id)
);

-- テナント管理者の招待（§5.14・v0.9.1）。運営管理者が招待し、本人が承諾すると association_admins に行が入る
create table association_admin_invitations (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete cascade,
  email          citext not null,
  invited_by     uuid not null references users(id),     -- 運営管理者
  status         text not null default 'pending'
                 check (status in ('pending','accepted','rejected','cancelled','expired')),
  expires_at     timestamptz not null,                   -- 招待（再送）+ 7 日【仮】
  responded_at   timestamptz,
  created_at     timestamptz not null default now()
);
create unique index association_admin_invitations_pending_uk
  on association_admin_invitations (association_id, email) where status = 'pending';

-- 運営管理者（全テナント横断・§5.14）。seed スクリプトでのみ登録する。画面からは付与できない
create table platform_admins (
  user_id                uuid primary key references users(id),
  granted_at             timestamptz not null default now(),
  note                   text,
  enroll_code_hash       text,                  -- seed が発行する登録用コード（HMAC）。初回の 2 段階認証の登録に必須（§5.14・P1）
  enroll_code_expires_at timestamptz            -- 発行 + 24 時間（P1）
);

-- 旧スラッグからの転送（§5.14）
create table association_slug_history (
  slug           text primary key,
  association_id uuid not null references associations(id),
  replaced_at    timestamptz not null default now()
);

-- 2 段階認証（テナント管理者・運営管理者・§9.4）。P1 のマイグレーションで作る
create table user_passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key    bytea not null,
  sign_count    bigint not null default 0,
  transports    text[],
  name          text,                          -- 「iPhone」「事務所の PC」など本人が付ける名前
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create table user_totp (
  user_id          uuid primary key references users(id) on delete cascade,
  secret_encrypted bytea not null,             -- MFA_ENCRYPTION_KEY で暗号化
  confirmed_at     timestamptz
);
create table user_recovery_codes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users(id) on delete cascade,
  code_hash text not null,
  used_at   timestamptz
);

-- 管理者の重要操作・運営管理者のテナント切り替えの記録（§5.14・§9.4）。個人情報は入れない
create table admin_access_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id),
  association_id uuid references associations(id),
  action         text not null,                -- enter_tenant | leave_tenant | physical_delete | invite_admin | accept_admin | revoke_admin | merge_members | import_memberships | change_slug | create_association | （P1）reset_2fa | mfa_changed | mfa_reverify（出力は export_logs・§5.13）
  target_id      uuid,
  created_at     timestamptz not null default now()
);
create index admin_access_logs_idx on admin_access_logs (association_id, created_at desc);

-- メール確認番号（§9。v0.5 までの login_tokens を置き換え）
-- v0.9: users はまだ存在しないことがある（確認番号の入力に成功するまで作らない）ため、メールアドレスで持つ
create table login_codes (
  id            uuid primary key default gen_random_uuid(),
  purpose       text not null default 'login' check (purpose in ('login','email_change')),  -- v0.9.1: メールアドレスの変更（§5.19）
  user_id       uuid references users(id) on delete cascade,  -- purpose = email_change のとき必須
  email         citext not null,                -- email_change では新しいアドレス
  attempt_hash  text not null,                -- SHA-256(試行 ID)。試行 ID は発行したブラウザの Cookie にだけある（§9.2）
  code_hash     text not null,                -- HMAC-SHA-256(LOGIN_CODE_HMAC_KEY, 試行 ID || code)。6 桁は総当たり可能なので鍵付き
  expires_at    timestamptz not null,         -- 発行 + 10 分
  attempt_count int not null default 0,       -- 間違えた回数（試行の合計で 5 回まで・アプリで検査）
  used_at       timestamptz,                  -- ワンタイム
  created_at    timestamptz not null default now(),
  check (purpose = 'login' or user_id is not null)
);
create index login_codes_attempt_idx on login_codes (attempt_hash, created_at desc);
create index login_codes_email_idx   on login_codes (email, created_at desc);

-- レート制限の回数（§9.2）。複数インスタンスで共有するため DB に置く。古い行は日次ジョブで削除
create table rate_limits (
  key          text not null,                 -- 例: login_request:email:<sha256>, login_verify:ip:<ip>, suggest:user:<id>
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key, window_start)
);

-- 物理削除の記録（§5.16）。消した中身は持たない
create table deletion_logs (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid references associations(id),
  table_name      text not null,
  record_id       uuid not null,
  cascaded_count  int not null default 0,     -- 一緒に消えた行の数
  reason          text,                       -- 保存期間満了 / 本人からの依頼 / 誤登録 など
  deleted_by      uuid not null references users(id),
  deleted_at      timestamptz not null default now()
);

create table sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  session_hash       text not null unique,    -- SHA-256(session id)
  expires_at         timestamptz not null,    -- スライディング: アクセス時に now + 10 日へ延長
  absolute_expires_at timestamptz not null,   -- 発行 + 90 日（延長の上限）
  last_seen_at       timestamptz not null default now(),  -- テナント管理者だけは 1 分に 1 回まで更新（同時ログインの制限・§9.2）
  mfa_verified_at    timestamptz,             -- 2 段階目を確認した時刻。管理者の権限はここから 24 時間／8 時間（§9.4・P1）
  entered_association_id uuid references associations(id),  -- 運営管理者が切り替えて入った協会（§5.14）
  entered_until      timestamptz,             -- 入った状態の期限
  created_at         timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

create table tournaments (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  name           text not null,
  event_date     date,
  age_reference_date date not null,            -- 年齢の基準日（要項ごとに異なる・§14-21）
  venue          text,
  description    text,
  entry_start_at timestamptz,                  -- 日付で入力し、その日の 0:00（日本時間）で保存（§5.4）
  entry_end_at   timestamptz not null,         -- 必須。日付で入力し、その日の 23:59:59（日本時間）で保存
  team_size_min  int not null default 4,
  team_size_max  int not null default 7,
  max_entries    int check (max_entries is null or max_entries > 0),
  status         text not null default 'draft'
                 check (status in ('draft','open','closed','archived')),
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id),
  unique (association_id, id),                 -- 子テーブルの複合外部キーの参照先（§5.14）
  check (team_size_min >= 1 and team_size_min <= team_size_max),
  check (entry_start_at is null or entry_start_at < entry_end_at)
  -- team_size_min >= 部門の court_size はテーブルをまたぐため、大会の保存時にアプリで検証する（§5.4）
);

-- 部門プリセット（テナントごと。協会によって構成が異なる・追加要望 2。code は不変の識別子）
create table category_presets (
  id            uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete cascade,
  code          text not null,                -- m_free, m_40, w_60, x_160 ...
  label_default text not null,                -- 男子40歳以上の部 / 混合160オーバーの部
  gender        text not null check (gender in ('male','female','mixed')),
  rule_type     text not null check (rule_type in ('free','min_age','total_age')),
  rule_value    int,                          -- min_age: 40 / total_age: 160
  court_size        int not null default 4,   -- コート上の人数（§14-20）
  mixed_min_male    int not null default 1,   -- 混合: 男の最少人数
  mixed_min_female  int not null default 2,   -- 混合: 女の最少人数
  sort_order    int not null default 0,
  is_active     boolean not null default true, -- false = 新しい大会の部門の候補に出さない（過去の大会の部門はそのまま）
  deleted_at    timestamptz,
  deleted_by    uuid references users(id),
  unique (association_id, id),
  check (court_size >= 1),
  check (gender <> 'mixed' or mixed_min_male + mixed_min_female <= court_size),  -- 混合の最少人数の合計はコート上の人数以下（§5.4）
  check ((rule_type = 'free') = (rule_value is null))
);
create unique index category_presets_code_uk
  on category_presets (association_id, code) where deleted_at is null;

create table tournament_categories (
  id            uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  tournament_id uuid not null,
  preset_id     uuid not null,
  code          text not null,                -- preset.code のコピー（突合用）
  label         text not null,                -- 大会ごとの表示名（混合 / MIX の差を吸収）
  entry_end_at  timestamptz,                  -- NULL なら tournaments.entry_end_at を適用
  age_reference_date date,                    -- NULL なら tournaments.age_reference_date
  sort_order    int not null default 0,
  max_entries   int check (max_entries is null or max_entries > 0),  -- 部門ごとの申込上限（大会の上限と両方を見る・§5.4）
  deleted_at    timestamptz,
  deleted_by    uuid references users(id),
  unique (association_id, id),
  foreign key (association_id, tournament_id) references tournaments (association_id, id) on delete cascade,
  foreign key (association_id, preset_id) references category_presets (association_id, id)
);
create unique index tournament_categories_code_uk
  on tournament_categories (tournament_id, code) where deleted_at is null;  -- 前回コピー・年度比較はこのキーで突合

create table tournament_documents (
  id            uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  tournament_id uuid not null,
  doc_type      text not null check (doc_type in ('大会冊子','要項','組み合わせ','結果','その他')),
  title         text not null,
  storage_key   text not null,                -- 保管用バケット（非公開）のキー
  public_key    text,                         -- 公開用バケットのキー。公開中だけ入る。推測されにくいランダムな名前（§5.9）
  content_type  text not null check (content_type = 'application/pdf'),  -- PDF のみ（§5.9）
  size_bytes    int not null,
  is_public     boolean not null default true,
  sort_order    int not null default 0,
  uploaded_by   uuid references users(id),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    uuid references users(id),
  foreign key (association_id, tournament_id) references tournaments (association_id, id) on delete cascade
);

-- contact_messages の entry_id の外部キーは entries の作成後に追加する（下記）
create table contact_messages (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  tournament_id  uuid references tournaments(id) on delete set null,
  entry_id       uuid,                          -- 申込から開いたとき（§5.10）
  user_id        uuid references users(id),
  subject_type   text not null check (subject_type in ('変更','取消','ログイン','削除','その他')),
  sender_name    text not null,
  sender_email   text not null,
  body           text not null,
  status         text not null default 'new' check (status in ('new','done')),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id)
);
create index contact_messages_status_idx on contact_messages (association_id, status, created_at desc);

-- サイトの運営者宛ての問い合わせ（テナントに属さない・§5.10・v0.9.1）。運営管理者が /platform で読む
create table platform_contact_messages (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id),
  subject_type   text not null check (subject_type in ('ログイン','削除','その他')),
  sender_name    text not null,
  sender_email   text not null,
  body           text not null,
  status         text not null default 'new' check (status in ('new','done')),
  created_at     timestamptz not null default now()
);

-- 領収書・請求書の PDF（§5.20・P1・v0.9.2）。ones が freee 請求書で発行したものを運営管理者がアップロードする
create table billing_documents (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  kind           text not null check (kind in ('receipt','invoice')),
  title          text not null,                 -- 例: 2027年4月分 領収書
  storage_key    text not null,                 -- R2 の保管用バケット（公開用には置かない）
  size_bytes     int not null,
  uploaded_by    uuid not null references users(id),
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id)
);
create index billing_documents_idx on billing_documents (association_id, created_at desc) where deleted_at is null;

create table members (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id),
  name            text not null,
  kana            text,
  birth_date      date not null,                       -- 名寄せキー兼 年齢判定
  sex             text not null check (sex in ('male','female')),
  name_normalized text not null,
  kana_normalized text,
  -- 所属チームは team_members 経由で引く（直近所属はビューで導出）
  status          text not null default 'active'
                  check (status in ('active','needs_review','merged')),
  merged_into_id  uuid references members(id),
  entry_count     int not null default 0,
  last_entry_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  user_id         uuid references users(id),           -- 本人のアカウント（招待で紐づける・§5.15）
  deleted_at      timestamptz,
  deleted_by      uuid references users(id),
  unique (association_id, id)
);
-- 協会内で 1 アカウント = 1 人物
create unique index members_user_uk
  on members (association_id, user_id) where user_id is not null and deleted_at is null;
create index members_name_norm_trgm on members using gin (name_normalized gin_trgm_ops) where deleted_at is null;
create index members_kana_norm_trgm on members using gin (kana_normalized gin_trgm_ops) where deleted_at is null;
create index members_name_birth_idx  on members (association_id, name_normalized, birth_date) where deleted_at is null;  -- 名寄せの主経路・テナント内検索

-- チーム（追加要望 1）
create table teams (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  kind           text not null default 'team' check (kind in ('team','individual')),  -- individual = 個人登録（§5.11）
  name           text not null,
  kana           text,
  contact_email  text,
  contact_phone  text,
  membership_renewal_target boolean not null default false,  -- 協会員の登録をするチーム（年度更新の対象・§5.11）。個人登録は true
  status         text not null default 'active' check (status in ('active','inactive')),
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id),
  unique (association_id, id)
);
-- 個人登録は 1 協会につき 1 人 1 つ【仮】
create unique index teams_individual_uk
  on teams (association_id, created_by) where kind = 'individual' and deleted_at is null;

-- チーム名簿（人物の所属）。代表者は team_admins、本人のアカウントは members.user_id（v0.8）
create table team_members (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  member_id      uuid not null,
  joined_at      timestamptz not null default now(),
  left_at        timestamptz,                      -- 選手一覧から外した（脱退。削除とは別）
  left_by        uuid references users(id),        -- 外した代表者。直後の「元に戻す」はこの人だけ（§5.11）
  deleted_at     timestamptz,                      -- 論理削除（誤登録の取り消し）。テナント管理者だけが入れる（§5.11・v0.9.1）
  deleted_by     uuid references users(id),
  foreign key (association_id, team_id)   references teams   (association_id, id) on delete cascade,
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade
);
create index team_members_team_idx   on team_members (team_id, left_at) where deleted_at is null;
create index team_members_member_idx on team_members (member_id) where deleted_at is null;
create unique index team_members_active_uk
  on team_members (team_id, member_id) where left_at is null and deleted_at is null;

-- チームの代表者（アカウント × チーム・§3.1・§5.11）
create table team_admins (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  user_id        uuid not null references users(id),
  foreign key (association_id, team_id) references teams (association_id, id) on delete cascade,
  granted_by uuid references users(id),        -- NULL = チームを登録した本人。以後は委譲した代表者
  granted_at timestamptz not null default now(),
  revoked_at timestamptz                       -- 解除（最後の 1 人は解除不可をアプリで検査）
);
create unique index team_admins_active_uk on team_admins (team_id, user_id) where revoked_at is null;
create index team_admins_user_idx on team_admins (user_id) where revoked_at is null;

-- 招待（選手として / 代表者として・§5.15）
create table team_invitations (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  kind           text not null check (kind in ('player','admin')),
  member_id      uuid,                         -- kind = player のとき必須
  email          citext not null,
  invited_by     uuid not null references users(id),
  status         text not null default 'pending'
                 check (status in ('pending','accepted','rejected','cancelled','expired')),
  expires_at     timestamptz not null,         -- 招待（再送）+ 3 日
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  check (kind = 'admin' or member_id is not null),
  foreign key (association_id, team_id)   references teams   (association_id, id) on delete cascade,
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade
);
create index team_invitations_email_idx on team_invitations (email) where status = 'pending';
-- 返事待ちの招待を重ねない（§5.15）
create unique index team_invitations_player_pending_uk
  on team_invitations (association_id, member_id) where kind = 'player' and status = 'pending';
create unique index team_invitations_admin_pending_uk
  on team_invitations (team_id, email) where kind = 'admin' and status = 'pending';

-- 年度別の協会員資格（§5.12）
create table memberships (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  member_id      uuid not null,
  team_id        uuid,                          -- 申告元のチーム
  year           int not null,                  -- 年度（開始年。2026 年度 = 2026/4〜2027/3）
  status         text not null check (status in ('applied','approved','declined','expired')),
  source         text not null default 'renewal'
                 check (source in ('renewal','additional','import')),  -- 通常の申告／年度途中の追加の申告（承認必須）／取り込み（§5.12）
  applied_by     uuid references users(id),
  applied_at     timestamptz,
  approved_by    uuid references users(id),
  approved_at    timestamptz,
  deleted_at     timestamptz,
  deleted_by     uuid references users(id),
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade,
  foreign key (association_id, team_id)   references teams   (association_id, id) on delete set null (team_id)
);
create unique index memberships_member_year_uk
  on memberships (association_id, member_id, year) where deleted_at is null;
create index memberships_year_idx on memberships (association_id, year, status);

-- 年度更新の受付（運営が開始し、締切を持つ）
create table membership_periods (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  year           int not null,
  opens_at       timestamptz not null,
  closes_at      timestamptz not null,
  auto_approve   boolean not null default false,  -- §14-27
  unique (association_id, year),
  check (opens_at < closes_at)
);

-- チーム × 年度の申告の送信記録（§5.12・v0.9）。行がない = 未申告
create table membership_declarations (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  year           int not null,
  submitted_by   uuid references users(id),
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (association_id, team_id) references teams (association_id, id) on delete cascade,
  unique (association_id, team_id, year)
);

-- 名簿・CSV の出力記録（§12 個人情報要件）
create table export_logs (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  user_id        uuid references users(id),
  scope          text not null,                 -- association | team | tournament
  scope_id       uuid,
  format         text not null,                 -- csv | tsv | md | pdf
  year           int,                           -- 会員区分を判定した年度
  includes_birth_date boolean not null default false,
  row_count      int,
  created_at     timestamptz not null default now()
);

create table member_aliases (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null,
  member_id       uuid not null,
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade,
  name_normalized text not null,
  kana_normalized text,
  created_at      timestamptz not null default now(),
  unique (member_id, name_normalized, kana_normalized)
);

create table entries (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null,
  tournament_id       uuid not null,
  category_id         uuid not null,               -- 部門は必須（§5.5。v0.9 で NOT NULL に）
  team_id             uuid not null,
  created_by          uuid not null references users(id),
  team_name           text not null,               -- 申込時点のスナップショット
  note                text,                        -- 連絡先はチーム（teams）に一本化（v0.9 で representative_name / contact_phone を削除）
  status              text not null default 'submitted'
                      check (status in ('submitted','cancelled')),
  needs_admin_check   boolean not null default false,  -- 合計年齢部門など、運営の確認対象
  submitted_at        timestamptz not null default now(),
  cancelled_at        timestamptz,
  updated_by          uuid references users(id),   -- 締切後の管理者編集を記録
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,                 -- 論理削除（取消 = status とは別・§5.16）
  deleted_by          uuid references users(id),
  unique (association_id, id),
  foreign key (association_id, tournament_id) references tournaments           (association_id, id) on delete cascade,
  foreign key (association_id, category_id)   references tournament_categories (association_id, id) on delete cascade,
  foreign key (association_id, team_id)       references teams                 (association_id, id)  -- 申込のあるチームは物理削除できない（§5.16）
  -- 部門がその大会のものであることはアプリで検査する
);
alter table contact_messages
  add foreign key (association_id, entry_id) references entries (association_id, id) on delete set null (entry_id);
create index entries_tournament_idx on entries (tournament_id, status) where deleted_at is null;
create index entries_created_by_idx on entries (created_by, submitted_at desc);
create index entries_team_idx       on entries (team_id, submitted_at desc);

-- 申込時点のスナップショット（members が後から直されても申込内容は変わらない）
create table entry_players (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null,
  entry_id        uuid not null,
  foreign key (association_id, entry_id)  references entries (association_id, id) on delete cascade,
  foreign key (association_id, member_id) references members (association_id, id) on delete set null (member_id),
  position        int not null,
  name            text not null,
  kana            text,
  birth_date      date,                                 -- 申込時は必須（アプリで検査）。人物の物理削除時に NULL へ匿名化（§5.16）
  sex             text not null check (sex in ('male','female')),
  age_at_event    int,                                  -- 基準日時点の満年齢（保存時に確定。基準日の変更は管理者の確定操作で再計算・§5.4）
  name_normalized text not null,
  kana_normalized text,
  member_id       uuid,                                 -- 人物の物理削除で NULL（match_type = unmatched・§8.3）
  match_type      text check (match_type in ('picked','auto_exact','auto_new','unmatched')),
  unique (entry_id, position)
);

-- 申込の変更履歴（特に締切後の管理者による代理修正）
create table entry_audits (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  entry_id       uuid not null,
  actor_id       uuid references users(id),
  action         text not null check (action in ('create','update','cancel','recalc_age','admin_checked')),
  before         jsonb,                        -- 生年月日は入れない（§5.16）
  after          jsonb,
  foreign key (association_id, entry_id) references entries (association_id, id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index entry_audits_entry_idx on entry_audits (entry_id, created_at desc);

-- メールの送信記録と送信待ちの表を兼ねる（§11・v0.9）
create table mail_logs (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid references associations(id),   -- 確認番号など協会に属さないメールは NULL
  mail_type           text not null,
  to_email            text not null,
  user_id             uuid references users(id),
  entry_id            uuid references entries(id) on delete set null,
  params              jsonb not null default '{}',        -- 本文を組み立てるための ID だけ（本文・生年月日は入れない）
  status              text not null default 'queued'
                      check (status in ('queued','sent','failed','bounced')),
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null default now(),
  provider_message_id text,
  error               text,                                -- 個人情報を含めない
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index mail_logs_queue_idx on mail_logs (next_attempt_at) where status = 'queued';
create index mail_logs_daily_idx on mail_logs (sent_at) where status = 'sent';   -- 1 日の送信数（§11.2）

-- 初期データ: 早良区協会（v0.9。プリセットより先に協会の行を作る。§5.14「テナントの作成」と同じ内容）
insert into associations (id, name, slug, fiscal_year_start_month)
values ('00000000-0000-0000-0000-000000000001', '早良区協会', 'sawara', 4);

-- 部門プリセットの seed（男子・女子は 18/30/40/50/60/70、混合は 160/180/200）
insert into category_presets (association_id, code, label_default, gender, rule_type, rule_value, sort_order) values  -- 先頭列は早良区協会の id
  ('00000000-0000-0000-0000-000000000001','m_free','男子フリーの部','male','free',null,10),
  ('00000000-0000-0000-0000-000000000001','m_18','男子18歳以上の部','male','min_age',18,11),
  ('00000000-0000-0000-0000-000000000001','m_30','男子30歳以上の部','male','min_age',30,12),
  ('00000000-0000-0000-0000-000000000001','m_40','男子40歳以上の部','male','min_age',40,13),
  ('00000000-0000-0000-0000-000000000001','m_50','男子50歳以上の部','male','min_age',50,14),
  ('00000000-0000-0000-0000-000000000001','m_60','男子60歳以上の部','male','min_age',60,15),
  ('00000000-0000-0000-0000-000000000001','m_70','男子70歳以上の部','male','min_age',70,16),
  ('00000000-0000-0000-0000-000000000001','w_free','女子フリーの部','female','free',null,20),
  ('00000000-0000-0000-0000-000000000001','w_18','女子18歳以上の部','female','min_age',18,21),
  ('00000000-0000-0000-0000-000000000001','w_30','女子30歳以上の部','female','min_age',30,22),
  ('00000000-0000-0000-0000-000000000001','w_40','女子40歳以上の部','female','min_age',40,23),
  ('00000000-0000-0000-0000-000000000001','w_50','女子50歳以上の部','female','min_age',50,24),
  ('00000000-0000-0000-0000-000000000001','w_60','女子60歳以上の部','female','min_age',60,25),
  ('00000000-0000-0000-0000-000000000001','w_70','女子70歳以上の部','female','min_age',70,26),
  ('00000000-0000-0000-0000-000000000001','x_free','混合フリーの部','mixed','free',null,30),
  ('00000000-0000-0000-0000-000000000001','x_160','混合160オーバーの部','mixed','total_age',160,31),
  ('00000000-0000-0000-0000-000000000001','x_180','混合180オーバーの部','mixed','total_age',180,32),
  ('00000000-0000-0000-0000-000000000001','x_200','混合200オーバーの部','mixed','total_age',200,33);
-- 混合の男女比（男 1 以上・女 2 以上）とコート人数 4 は列の既定値

-- ============================================================
-- 行レベルセキュリティ（採用する場合・§5.14）。v0.9 でロールの分離を追加
-- ============================================================
-- DB の日付は日本時間で扱う（current_date・age() のずれを防ぐ・§7.0）
-- alter database <db> set timezone = 'Asia/Tokyo';

-- ロール: 所有者（マイグレーション）／アプリ／ジョブ／バックアップ／関数の定義者
-- create role app_owner   login;                 -- テーブルの所有者。MIGRATION_DATABASE_URL
-- create role app_user    login;                 -- アプリ。所有者ではなく BYPASSRLS なし。DATABASE_URL
-- create role app_job     login;                 -- 日次ジョブ。協会ごとに SET LOCAL する
-- create role app_backup  login bypassrls;       -- pg_dump 専用。SELECT のみ
-- create role app_definer nologin bypassrls;     -- 下の SECURITY DEFINER 関数の所有者（ログインできない）
-- grant select, insert, update, delete on <テナントに属する表> to app_user, app_job;
-- grant select on all tables in schema public to app_backup;
-- revoke all on platform_admins from app_user; grant select on platform_admins to app_user;

-- テナントに属する全テーブル（§5.14 の一覧）に同じ形で張る。例:
-- alter table teams enable row level security;
-- alter table teams force  row level security;   -- 所有者で接続しても効かせる
-- create policy teams_tenant on teams
--   using      (association_id = current_setting('app.association_id', true)::uuid)
--   with check (association_id = current_setting('app.association_id', true)::uuid);
-- アプリはトランザクション冒頭で SET LOCAL app.association_id = '…' と SET LOCAL app.user_id = '…' を実行する

-- 協会をまたぐ画面のための関数（§5.14「協会をまたぐ画面」）。所有者は app_definer
-- create function my_association_ids() returns setof uuid
--   language sql stable security definer set search_path = public as $$
--     select association_id from association_admins
--      where user_id = current_setting('app.user_id', true)::uuid
--     union
--     select association_id from team_admins
--      where user_id = current_setting('app.user_id', true)::uuid and revoked_at is null
--     union
--     select association_id from members
--      where user_id = current_setting('app.user_id', true)::uuid and deleted_at is null
--   $$;
-- create function my_pending_invitations()
--   returns table (invitation_id uuid, association_name text, association_slug text,
--                  team_name text, kind text, inviter_name text, expires_at timestamptz)
--   language sql stable security definer set search_path = public as $$
--     select i.id, a.name, a.slug, t.name, i.kind, iu.display_name, i.expires_at
--       from team_invitations i
--       join users u  on u.email = i.email and u.email_verified_at is not null
--                    and u.id = current_setting('app.user_id', true)::uuid
--       join teams t  on t.id = i.team_id and t.deleted_at is null
--       join associations a on a.id = i.association_id
--       left join users iu on iu.id = i.invited_by
--      where i.status = 'pending' and i.expires_at > now()
--     union all
--     select i.id, a.name, a.slug, null, 'association_admin', iu.display_name, i.expires_at  -- テナント管理者の招待（v0.9.1）
--       from association_admin_invitations i
--       join users u  on u.email = i.email and u.email_verified_at is not null
--                    and u.id = current_setting('app.user_id', true)::uuid
--       join associations a on a.id = i.association_id
--       left join users iu on iu.id = i.invited_by
--      where i.status = 'pending' and i.expires_at > now()
--   $$;
-- create function platform_association_stats()   -- 運営管理者のみ。件数だけを返す（§5.14）
--   returns table (association_id uuid, teams bigint, members bigint, open_tournaments bigint)
--   language sql stable security definer set search_path = public as $$
--     select a.id,
--            (select count(*) from teams t where t.association_id = a.id and t.deleted_at is null),
--            (select count(*) from members m where m.association_id = a.id and m.deleted_at is null),
--            (select count(*) from tournaments x where x.association_id = a.id and x.status = 'open' and x.deleted_at is null)
--       from associations a
--      where exists (select 1 from platform_admins p
--                     where p.user_id = current_setting('app.user_id', true)::uuid)
--   $$;
-- revoke execute on all functions in schema public from public;
-- grant execute on function my_association_ids(), my_pending_invitations(), platform_association_stats() to app_user;

-- スケッチの player_suggestions はビューとして実装（ES 移行時はここを差し替える）
-- v0.9.2: 候補は「代表者を務めるチームの選手」だけにするため、人物 × 現役の所属チームの行で持つ（絞り込みは付録 C）
create view player_suggestions with (security_invoker = true) as  -- 呼び出したロール（app_user）の RLS を効かせる
select m.id as member_id, m.association_id, m.name, m.kana,
       m.name_normalized, m.kana_normalized, m.birth_date, m.sex,
       m.entry_count, m.last_entry_at,
       tm.team_id, t.name as team_name
from members m
join team_members tm on tm.member_id = m.id and tm.left_at is null and tm.deleted_at is null
join teams t on t.id = tm.team_id and t.deleted_at is null and t.status = 'active'
where m.status in ('active','needs_review')
  and m.deleted_at is null;                    -- 論理削除済みはサジェストに出さない（§5.16）
```

