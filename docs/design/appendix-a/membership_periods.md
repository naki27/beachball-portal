```sql
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
```
