```sql
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
```
