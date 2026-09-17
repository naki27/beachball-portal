```sql
-- 招待（選手として / 代表者として・§5.15）
create table team_invitations (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null,
  team_id        uuid not null,
  kind           text not null check (kind in ('player','admin')),
  member_id      uuid,                         -- kind = player のとき必須
  email          citext not null,
  invited_by     uuid not null references users(id),
  status         text not null default 'pending'
                 check (status in ('pending','accepted','rejected','cancelled','expired')),
  expires_at     timestamptz not null,         -- 招待（再送）+ 3 日
  responded_at   timestamptz,
  created_at     timestamptz not null default now(),
  check (kind = 'admin' or member_id is not null),
  foreign key (association_id, team_id)   references teams   (association_id, id) on delete cascade,
  foreign key (association_id, member_id) references members (association_id, id) on delete cascade
);
create index team_invitations_email_idx on team_invitations (email) where status = 'pending';
-- 返事待ちの招待を重ねない（§5.15）
create unique index team_invitations_player_pending_uk
  on team_invitations (association_id, member_id) where kind = 'player' and status = 'pending';
create unique index team_invitations_admin_pending_uk
  on team_invitations (team_id, email) where kind = 'admin' and status = 'pending';
```
