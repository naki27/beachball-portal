```sql
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
```
