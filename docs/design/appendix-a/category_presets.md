```sql
-- 部門プリセット（テナントごと。協会によって構成が異なる・追加要望 2。code は不変の識別子）
create table category_presets (
  id            uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete cascade,
  code          text not null,                -- m_free, m_40, w_60, x_160 ...
  label_default text not null,                -- 男子40歳以上の部 / 混合160オーバーの部
  gender        text not null check (gender in ('male','female','mixed')),
  rule_type     text not null check (rule_type in ('free','min_age','total_age')),
  rule_value    int,                          -- min_age: 40 / total_age: 160
  court_size        int not null default 4,   -- コート上の人数（§14-20）
  mixed_min_male    int not null default 1,   -- 混合: 男の最少人数
  mixed_min_female  int not null default 2,   -- 混合: 女の最少人数
  sort_order    int not null default 0,
  is_active     boolean not null default true, -- false = 新しい大会の部門の候補に出さない（過去の大会の部門はそのまま）
  deleted_at    timestamptz,
  deleted_by    uuid references users(id),
  unique (association_id, id),
  check (court_size >= 1),
  check (gender <> 'mixed' or mixed_min_male + mixed_min_female <= court_size),  -- 混合の最少人数の合計はコート上の人数以下（§5.4）
  check ((rule_type = 'free') = (rule_value is null))
);
create unique index category_presets_code_uk
  on category_presets (association_id, code) where deleted_at is null;
```
