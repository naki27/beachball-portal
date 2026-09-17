```sql
-- テナント管理者の招待（§5.14・v0.9.1）。運営管理者が招待し、本人が承諾すると association_admins に行が入る
create table association_admin_invitations (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete cascade,
  email          citext not null,
  invited_by     uuid not null references users(id),     -- 運営管理者
  status         text not null default 'pending'
                 check (status in ('pending','accepted','rejected','cancelled','expired')),
  expires_at     timestamptz not null,                   -- 招待（再送）+ 7 日【仮】
  responded_at   timestamptz,
  created_at     timestamptz not null default now()
);
create unique index association_admin_invitations_pending_uk
  on association_admin_invitations (association_id, email) where status = 'pending';
```
