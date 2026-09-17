```sql
create table tournaments (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id),
  name           text not null,
  event_date     date,
  age_reference_date date not null,            -- 年齢の基準日（要項ごとに異なる・§14-21）
  venue          text,
  description    text,
  entry_start_at timestamptz,                  -- 日付で入力し、その日の 0:00（日本時間）で保存（§5.4）
  entry_end_at   timestamptz not null,         -- 必須。日付で入力し、その日の 23:59:59（日本時間）で保存
  team_size_min  int not null default 4,
  team_size_max  int not null default 7,
  max_entries    int check (max_entries is null or max_entries > 0),
  status         text not null default 'draft'
                 check (status in ('draft','open','closed','archived')),
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     uuid references users(id),
  unique (association_id, id),                 -- 子テーブルの複合外部キーの参照先（§5.14）
  check (team_size_min >= 1 and team_size_min <= team_size_max),
  check (entry_start_at is null or entry_start_at < entry_end_at)
  -- team_size_min >= 部門の court_size はテーブルをまたぐため、大会の保存時にアプリで検証する（§5.4）
);
```
