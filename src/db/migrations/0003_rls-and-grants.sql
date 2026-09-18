-- RLS とロールの権限（設計書 §5.14「漏れを機構で防ぐ」・§6.6・付録 A）。書き方の決まりは docs/adr/0002
-- 新しいテナントの表を足すときは「enable → force → policy → grant」の 5 文をそのまま写す

-- ポリシーの式は 1 か所。未設定でも '' でも NULL → 0 件（'' は SET LOCAL したトランザクションが終わったあとの値）
create or replace function current_association_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.association_id', true), '')::uuid $$;
--> statement-breakpoint
create or replace function current_user_id() returns uuid
  language sql stable parallel safe
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- ============================================================
-- テナントに属する表（§5.14 の一覧のうち A-01・A-02 で作った分）
-- ============================================================
alter table association_admins enable row level security;
--> statement-breakpoint
alter table association_admins force row level security;
--> statement-breakpoint
create policy association_admins_tenant on association_admins
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on association_admins to app_user, app_job;
--> statement-breakpoint
grant select on association_admins to app_backup, app_definer;
--> statement-breakpoint

alter table association_admin_invitations enable row level security;
--> statement-breakpoint
alter table association_admin_invitations force row level security;
--> statement-breakpoint
create policy association_admin_invitations_tenant on association_admin_invitations
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on association_admin_invitations to app_user, app_job;
--> statement-breakpoint
grant select on association_admin_invitations to app_backup, app_definer;
--> statement-breakpoint

alter table association_slug_history enable row level security;
--> statement-breakpoint
alter table association_slug_history force row level security;
--> statement-breakpoint
create policy association_slug_history_tenant on association_slug_history
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert on association_slug_history to app_user;
--> statement-breakpoint
grant select on association_slug_history to app_job, app_backup;
--> statement-breakpoint

alter table category_presets enable row level security;
--> statement-breakpoint
alter table category_presets force row level security;
--> statement-breakpoint
create policy category_presets_tenant on category_presets
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on category_presets to app_user, app_job;
--> statement-breakpoint
grant select on category_presets to app_backup;
--> statement-breakpoint

-- 物理削除の記録。消さない・書き換えない（§5.16）
alter table deletion_logs enable row level security;
--> statement-breakpoint
alter table deletion_logs force row level security;
--> statement-breakpoint
create policy deletion_logs_tenant on deletion_logs
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert on deletion_logs to app_user, app_job;
--> statement-breakpoint
grant select on deletion_logs to app_backup;
--> statement-breakpoint

alter table teams enable row level security;
--> statement-breakpoint
alter table teams force row level security;
--> statement-breakpoint
create policy teams_tenant on teams
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on teams to app_user, app_job;
--> statement-breakpoint
grant select on teams to app_backup, app_definer;
--> statement-breakpoint

alter table team_members enable row level security;
--> statement-breakpoint
alter table team_members force row level security;
--> statement-breakpoint
create policy team_members_tenant on team_members
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on team_members to app_user, app_job;
--> statement-breakpoint
grant select on team_members to app_backup;
--> statement-breakpoint

alter table team_admins enable row level security;
--> statement-breakpoint
alter table team_admins force row level security;
--> statement-breakpoint
create policy team_admins_tenant on team_admins
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on team_admins to app_user, app_job;
--> statement-breakpoint
grant select on team_admins to app_backup, app_definer;
--> statement-breakpoint

alter table team_invitations enable row level security;
--> statement-breakpoint
alter table team_invitations force row level security;
--> statement-breakpoint
create policy team_invitations_tenant on team_invitations
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on team_invitations to app_user, app_job;
--> statement-breakpoint
grant select on team_invitations to app_backup, app_definer;
--> statement-breakpoint

alter table members enable row level security;
--> statement-breakpoint
alter table members force row level security;
--> statement-breakpoint
create policy members_tenant on members
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on members to app_user, app_job;
--> statement-breakpoint
grant select on members to app_backup, app_definer;
--> statement-breakpoint

alter table member_aliases enable row level security;
--> statement-breakpoint
alter table member_aliases force row level security;
--> statement-breakpoint
create policy member_aliases_tenant on member_aliases
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on member_aliases to app_user, app_job;
--> statement-breakpoint
grant select on member_aliases to app_backup;
--> statement-breakpoint

-- ============================================================
-- テナントに属さない表（RLS なし。権限だけ）
-- ============================================================
grant select, insert, update on associations to app_user;
--> statement-breakpoint
grant select on associations to app_job, app_backup, app_definer;
--> statement-breakpoint
grant select, insert, update on users to app_user;
--> statement-breakpoint
grant select, update on users to app_job;
--> statement-breakpoint
grant select on users to app_backup, app_definer;
--> statement-breakpoint
grant select, insert, update, delete on sessions to app_user;
--> statement-breakpoint
grant select, delete on sessions to app_job;
--> statement-breakpoint
grant select on sessions to app_backup;
--> statement-breakpoint
grant select, insert, update on login_codes to app_user;
--> statement-breakpoint
grant select, delete on login_codes to app_job;
--> statement-breakpoint
grant select on login_codes to app_backup;
--> statement-breakpoint
grant select, insert, update, delete on rate_limits to app_user;
--> statement-breakpoint
grant select, delete on rate_limits to app_job;
--> statement-breakpoint
grant select on rate_limits to app_backup;
--> statement-breakpoint
-- 運営管理者は seed だけが登録する。アプリは読むだけ
grant select on platform_admins to app_user, app_backup, app_definer;
--> statement-breakpoint

-- どちらにもまたがる表: アプリ用ロールは insert だけ。読むのは管理画面用の関数経由（§5.14）
grant insert on admin_access_logs to app_user;
--> statement-breakpoint
grant select, delete on admin_access_logs to app_job;
--> statement-breakpoint
grant select on admin_access_logs to app_backup;
--> statement-breakpoint
grant insert on mail_logs to app_user;
--> statement-breakpoint
grant select, insert, update, delete on mail_logs to app_job;
--> statement-breakpoint
grant select on mail_logs to app_backup;
--> statement-breakpoint

-- バックアップ（pg_dump）は drizzle のマイグレーション表も読む
grant usage on schema drizzle to app_backup;
--> statement-breakpoint
grant select on all tables in schema drizzle to app_backup;
--> statement-breakpoint

-- ============================================================
-- 協会をまたぐ画面のための関数（§5.14「協会をまたぐ画面」・付録 A）。所有者は app_definer
-- ユーザー ID は引数で受け取らず、アプリが SET LOCAL した app.user_id から読む
-- ============================================================
create or replace function my_association_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
    select association_id from association_admins
     where user_id = current_user_id()
    union
    select association_id from team_admins
     where user_id = current_user_id() and revoked_at is null
    union
    select association_id from members
     where user_id = current_user_id() and deleted_at is null
  $$;
--> statement-breakpoint
alter function my_association_ids() owner to app_definer;
--> statement-breakpoint
revoke execute on function my_association_ids() from public;
--> statement-breakpoint
grant execute on function my_association_ids() to app_user;
--> statement-breakpoint

create or replace function my_pending_invitations()
  returns table (invitation_id uuid, association_name text, association_slug text,
                 team_name text, kind text, inviter_name text, expires_at timestamptz)
  language sql stable security definer set search_path = public as $$
    select i.id, a.name, a.slug, t.name, i.kind, iu.display_name, i.expires_at
      from team_invitations i
      join users u  on u.email = i.email and u.email_verified_at is not null and u.deleted_at is null
                   and u.id = current_user_id()
      join teams t  on t.id = i.team_id and t.deleted_at is null
      join associations a on a.id = i.association_id
      left join users iu on iu.id = i.invited_by
     where i.status = 'pending' and i.expires_at > now()
    union all
    select i.id, a.name, a.slug, null, 'association_admin', iu.display_name, i.expires_at
      from association_admin_invitations i
      join users u  on u.email = i.email and u.email_verified_at is not null and u.deleted_at is null
                   and u.id = current_user_id()
      join associations a on a.id = i.association_id
      left join users iu on iu.id = i.invited_by
     where i.status = 'pending' and i.expires_at > now()
  $$;
--> statement-breakpoint
alter function my_pending_invitations() owner to app_definer;
--> statement-breakpoint
revoke execute on function my_pending_invitations() from public;
--> statement-breakpoint
grant execute on function my_pending_invitations() to app_user;
--> statement-breakpoint

-- 運営管理者のみ。件数だけを返す（§5.14）。open_tournaments は tournaments を作る B-01 で数える形に置き換える
create or replace function platform_association_stats()
  returns table (association_id uuid, teams bigint, members bigint, open_tournaments bigint)
  language sql stable security definer set search_path = public as $$
    select a.id,
           (select count(*) from teams t where t.association_id = a.id and t.deleted_at is null),
           (select count(*) from members m where m.association_id = a.id and m.deleted_at is null),
           0::bigint
      from associations a
     where exists (select 1 from platform_admins p where p.user_id = current_user_id())
  $$;
--> statement-breakpoint
alter function platform_association_stats() owner to app_definer;
--> statement-breakpoint
revoke execute on function platform_association_stats() from public;
--> statement-breakpoint
grant execute on function platform_association_stats() to app_user;
