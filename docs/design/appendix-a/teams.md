```sql
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
```
