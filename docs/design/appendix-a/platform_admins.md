```sql
-- 運営管理者（全テナント横断・§5.14）。seed スクリプトでのみ登録する。画面からは付与できない
create table platform_admins (
  user_id                uuid primary key references users(id),
  granted_at             timestamptz not null default now(),
  note                   text,
  enroll_code_hash       text,                  -- seed が発行する登録用コード（HMAC）。初回の 2 段階認証の登録に必須（§5.14・P1）
  enroll_code_expires_at timestamptz            -- 発行 + 24 時間（P1）
);
```
