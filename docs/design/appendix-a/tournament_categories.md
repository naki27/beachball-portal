```sql
create table tournament_categories (
  id            uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  tournament_id uuid not null,
  preset_id     uuid not null,
  code          text not null,                -- preset.code のコピー（突合用）
  label         text not null,                -- 大会ごとの表示名（混合 / MIX の差を吸収）
  entry_end_at  timestamptz,                  -- NULL なら tournaments.entry_end_at を適用
  age_reference_date date,                    -- NULL なら tournaments.age_reference_date
  sort_order    int not null default 0,
  max_entries   int check (max_entries is null or max_entries > 0),  -- 部門ごとの申込上限（大会の上限と両方を見る・§5.4）
  deleted_at    timestamptz,
  deleted_by    uuid references users(id),
  unique (association_id, id),
  foreign key (association_id, tournament_id) references tournaments (association_id, id) on delete cascade,
  foreign key (association_id, preset_id) references category_presets (association_id, id)
);
create unique index tournament_categories_code_uk
  on tournament_categories (tournament_id, code) where deleted_at is null;  -- 前回コピー・年度比較はこのキーで突合
```
