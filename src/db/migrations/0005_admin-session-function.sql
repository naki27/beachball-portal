-- テナント管理者の同時ログインの制限（設計書 §9.2）で使う関数
-- 「どこかの協会の association_admins に行があるか」は RLS の下では読めない（協会が決まっていない）ので、
-- SECURITY DEFINER で app.user_id の人だけを見る（docs/adr/0002 の決まりどおり、引数でユーザー ID は受け取らない）
create or replace function current_user_is_association_admin() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from association_admins a
       where a.user_id = current_user_id()
    )
  $$;
--> statement-breakpoint
alter function current_user_is_association_admin() owner to app_definer;
--> statement-breakpoint
revoke execute on function current_user_is_association_admin() from public;
--> statement-breakpoint
grant execute on function current_user_is_association_admin() to app_user;
