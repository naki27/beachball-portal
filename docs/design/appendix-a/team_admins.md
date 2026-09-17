```sql
-- チームの代表者（アカウント × チーム・§3.1・§5.11）
create table team_admins (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  user_id        uuid not null references users(id),
  foreign key (association_id, team_id) references teams (association_id, id) on delete cascade,
  granted_by uuid references users(id),        -- NULL = チームを登録した本人。以後は委譲した代表者
  granted_at timestamptz not null default now(),
  revoked_at timestamptz                       -- 解除（最後の 1 人は解除不可をアプリで検査）
);
create unique index team_admins_active_uk on team_admins (team_id, user_id) where revoked_at is null;
create index team_admins_user_idx on team_admins (user_id) where revoked_at is null;
```
