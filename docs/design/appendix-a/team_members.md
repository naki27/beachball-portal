```sql
-- チーム名簿（人物の所属）。代表者は team_admins、本人のアカウントは members.user_id（v0.8）
create table team_members (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  member_id      uuid not null,
  joined_at      timestamptz not null default now(),
  left_at        timestamptz,                      -- 選手一覧から外した（脱退。削除とは別）
  left_by        uuid references users(id),        -- 外した代表者。直後の「元に戻す」はこの人だけ（§5.11）
  deleted_at     timestamptz,                      -- 論理削除（誤登録の取り消し）。テナント管理者だけが入れる（§5.11・v0.9.1）
  deleted_by     uuid references users(id),
  foreign key (association_id, team_id)   references teams   (association_id, id) on delete cascade,
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade
);
create index team_members_team_idx   on team_members (team_id, left_at) where deleted_at is null;
create index team_members_member_idx on team_members (member_id) where deleted_at is null;
create unique index team_members_active_uk
  on team_members (team_id, member_id) where left_at is null and deleted_at is null;
```
