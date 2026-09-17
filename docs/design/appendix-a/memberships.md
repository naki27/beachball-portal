```sql
-- 年度別の協会員資格（§5.12）
create table memberships (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  member_id      uuid not null,
  team_id        uuid,                          -- 申告元のチーム
  year           int not null,                  -- 年度（開始年。2026 年度 = 2026/4〜2027/3）
  status         text not null check (status in ('applied','approved','declined','expired')),
  source         text not null default 'renewal'
                 check (source in ('renewal','additional','import')),  -- 通常の申告／年度途中の追加の申告（承認必須）／取り込み（§5.12）
  applied_by     uuid references users(id),
  applied_at     timestamptz,
  approved_by    uuid references users(id),
  approved_at    timestamptz,
  deleted_at     timestamptz,
  deleted_by     uuid references users(id),
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade,
  foreign key (association_id, team_id)   references teams   (association_id, id) on delete set null (team_id)
);
create unique index memberships_member_year_uk
  on memberships (association_id, member_id, year) where deleted_at is null;
create index memberships_year_idx on memberships (association_id, year, status);
```
