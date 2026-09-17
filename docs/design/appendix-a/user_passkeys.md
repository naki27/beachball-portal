```sql
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
```
