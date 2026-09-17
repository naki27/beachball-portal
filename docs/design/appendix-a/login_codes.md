```sql
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
```
