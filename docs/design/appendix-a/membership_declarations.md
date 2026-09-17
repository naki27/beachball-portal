```sql
-- チーム × 年度の申告の送信記録（§5.12・v0.9）。行がない = 未申告
create table membership_declarations (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  year           int not null,
  submitted_by   uuid references users(id),
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (association_id, team_id) references teams (association_id, id) on delete cascade,
  unique (association_id, team_id, year)
);
```
