-- 運営管理者の横断画面（設計書 §5.14「運営管理者」）で使う関数。どちらも app.user_id が運営管理者のときだけ行を返す
-- platform_association_stats() は 0003 の版に「協会の管理者の人数」「返事待ちの招待の数」を足す（戻り値の型が変わるので作り直す）
drop function if exists platform_association_stats();
--> statement-breakpoint
create function platform_association_stats()
  returns table (association_id uuid, teams bigint, members bigint, open_tournaments bigint,
                 admins bigint, pending_admin_invitations bigint)
  language sql stable security definer set search_path = public as $$
    select a.id,
           (select count(*) from teams t where t.association_id = a.id and t.deleted_at is null),
           (select count(*) from members m where m.association_id = a.id and m.deleted_at is null),
           0::bigint,  -- 受付中の大会。tournaments を作る B-01 で数える形に置き換える
           (select count(*) from association_admins x where x.association_id = a.id),
           (select count(*) from association_admin_invitations i
             where i.association_id = a.id and i.status = 'pending' and i.expires_at > now())
      from associations a
     where exists (select 1 from platform_admins p where p.user_id = current_user_id())
  $$;
--> statement-breakpoint
alter function platform_association_stats() owner to app_definer;
--> statement-breakpoint
revoke execute on function platform_association_stats() from public;
--> statement-breakpoint
grant execute on function platform_association_stats() to app_user;
--> statement-breakpoint

-- テナント管理者の一覧。運営管理者にはテナント管理者のメールアドレスと表示名を見せてよい（§5.14 v0.9）。選手の情報は返さない
create or replace function platform_association_admins()
  returns table (association_id uuid, user_id uuid, email text, display_name text, granted_at timestamptz)
  language sql stable security definer set search_path = public as $$
    select x.association_id, x.user_id, u.email::text, u.display_name, x.granted_at
      from association_admins x
      join users u on u.id = x.user_id and u.deleted_at is null
     where exists (select 1 from platform_admins p where p.user_id = current_user_id())
     order by x.association_id, x.granted_at
  $$;
--> statement-breakpoint
alter function platform_association_admins() owner to app_definer;
--> statement-breakpoint
revoke execute on function platform_association_admins() from public;
--> statement-breakpoint
grant execute on function platform_association_admins() to app_user;
