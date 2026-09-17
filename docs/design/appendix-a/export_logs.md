```sql
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
```
