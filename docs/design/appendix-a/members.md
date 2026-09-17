```sql
create table members (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id),
  name            text not null,
  kana            text,
  birth_date      date not null,                       -- 名寄せキー兼 年齢判定
  sex             text not null check (sex in ('male','female')),
  name_normalized text not null,
  kana_normalized text,
  -- 所属チームは team_members 経由で引く（直近所属はビューで導出）
  status          text not null default 'active'
                  check (status in ('active','needs_review','merged')),
  merged_into_id  uuid references members(id),
  entry_count     int not null default 0,
  last_entry_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  user_id         uuid references users(id),           -- 本人のアカウント（招待で紐づける・§5.15）
  deleted_at      timestamptz,
  deleted_by      uuid references users(id),
  unique (association_id, id)
);
-- 協会内で 1 アカウント = 1 人物
create unique index members_user_uk
  on members (association_id, user_id) where user_id is not null and deleted_at is null;
create index members_name_norm_trgm on members using gin (name_normalized gin_trgm_ops) where deleted_at is null;
create index members_kana_norm_trgm on members using gin (kana_normalized gin_trgm_ops) where deleted_at is null;
create index members_name_birth_idx  on members (association_id, name_normalized, birth_date) where deleted_at is null;  -- 名寄せの主経路・テナント内検索
```
