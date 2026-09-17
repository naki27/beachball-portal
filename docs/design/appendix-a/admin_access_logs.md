```sql
-- 管理者の重要操作・運営管理者のテナント切り替えの記録（§5.14・§9.4）。個人情報は入れない
create table admin_access_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id),
  association_id uuid references associations(id),
  action         text not null,                -- enter_tenant | leave_tenant | physical_delete | invite_admin | accept_admin | revoke_admin | merge_members | import_memberships | change_slug | create_association | （P1）reset_2fa | mfa_changed | mfa_reverify（出力は export_logs・§5.13）
  target_id      uuid,
  created_at     timestamptz not null default now()
);
create index admin_access_logs_idx on admin_access_logs (association_id, created_at desc);
```
