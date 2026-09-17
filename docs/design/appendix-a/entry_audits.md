```sql
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
```
