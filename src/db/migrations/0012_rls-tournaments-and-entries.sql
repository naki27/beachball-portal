-- 大会・申込・会員の表の RLS とロールの権限（設計書 §5.14「漏れを機構で防ぐ」・付録 A。書き方の決まりは docs/adr/0002）
-- 0003 と同じ「enable → force → policy → grant」の 5 文をそのまま写す

alter table tournaments enable row level security;
--> statement-breakpoint
alter table tournaments force row level security;
--> statement-breakpoint
create policy tournaments_tenant on tournaments
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on tournaments to app_user, app_job;
--> statement-breakpoint
-- app_definer は platform_association_stats()（受付中の大会の数）のため
grant select on tournaments to app_backup, app_definer;
--> statement-breakpoint

alter table tournament_categories enable row level security;
--> statement-breakpoint
alter table tournament_categories force row level security;
--> statement-breakpoint
create policy tournament_categories_tenant on tournament_categories
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on tournament_categories to app_user, app_job;
--> statement-breakpoint
grant select on tournament_categories to app_backup;
--> statement-breakpoint

alter table entries enable row level security;
--> statement-breakpoint
alter table entries force row level security;
--> statement-breakpoint
create policy entries_tenant on entries
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on entries to app_user, app_job;
--> statement-breakpoint
grant select on entries to app_backup;
--> statement-breakpoint

alter table entry_players enable row level security;
--> statement-breakpoint
alter table entry_players force row level security;
--> statement-breakpoint
create policy entry_players_tenant on entry_players
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on entry_players to app_user, app_job;
--> statement-breakpoint
grant select on entry_players to app_backup;
--> statement-breakpoint

-- 申込の変更履歴。消さない・書き換えない（deletion_logs と同じ扱い）
alter table entry_audits enable row level security;
--> statement-breakpoint
alter table entry_audits force row level security;
--> statement-breakpoint
create policy entry_audits_tenant on entry_audits
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert on entry_audits to app_user, app_job;
--> statement-breakpoint
grant select on entry_audits to app_backup;
--> statement-breakpoint

-- 名簿・CSV の出力記録。消さない・書き換えない（§12）
alter table export_logs enable row level security;
--> statement-breakpoint
alter table export_logs force row level security;
--> statement-breakpoint
create policy export_logs_tenant on export_logs
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert on export_logs to app_user, app_job;
--> statement-breakpoint
grant select on export_logs to app_backup;
--> statement-breakpoint

alter table memberships enable row level security;
--> statement-breakpoint
alter table memberships force row level security;
--> statement-breakpoint
create policy memberships_tenant on memberships
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on memberships to app_user, app_job;
--> statement-breakpoint
grant select on memberships to app_backup;
--> statement-breakpoint

alter table membership_periods enable row level security;
--> statement-breakpoint
alter table membership_periods force row level security;
--> statement-breakpoint
create policy membership_periods_tenant on membership_periods
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on membership_periods to app_user, app_job;
--> statement-breakpoint
grant select on membership_periods to app_backup;
--> statement-breakpoint

alter table membership_declarations enable row level security;
--> statement-breakpoint
alter table membership_declarations force row level security;
--> statement-breakpoint
create policy membership_declarations_tenant on membership_declarations
  using (association_id = current_association_id())
  with check (association_id = current_association_id());
--> statement-breakpoint
grant select, insert, update, delete on membership_declarations to app_user, app_job;
--> statement-breakpoint
grant select on membership_declarations to app_backup;
--> statement-breakpoint

-- 運営管理者の横断画面の「受付中の大会」を、0006 の 0 固定から tournaments を数える形にする（§5.14）
-- 戻り値の型は 0006 と同じなので create or replace で差し替えられる
create or replace function platform_association_stats()
  returns table (association_id uuid, teams bigint, members bigint, open_tournaments bigint,
                 admins bigint, pending_admin_invitations bigint)
  language sql stable security definer set search_path = public as $$
    select a.id,
           (select count(*) from teams t where t.association_id = a.id and t.deleted_at is null),
           (select count(*) from members m where m.association_id = a.id and m.deleted_at is null),
           (select count(*) from tournaments o
             where o.association_id = a.id and o.status = 'open' and o.deleted_at is null),
           (select count(*) from association_admins x where x.association_id = a.id),
           (select count(*) from association_admin_invitations i
             where i.association_id = a.id and i.status = 'pending' and i.expires_at > now())
      from associations a
     where exists (select 1 from platform_admins p where p.user_id = current_user_id())
  $$;
