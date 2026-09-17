```sql
-- 旧スラッグからの転送（§5.14）
create table association_slug_history (
  slug           text primary key,
  association_id uuid not null references associations(id),
  replaced_at    timestamptz not null default now()
);
```
